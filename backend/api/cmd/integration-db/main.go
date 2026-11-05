// integration-db manages only isolated harness schemas in linkbook_test.
package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"os"
	"os/signal"
	"regexp"
	"syscall"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
func run() error {
	if (len(os.Args) != 3 && len(os.Args) != 4) || !regexp.MustCompile(`^e2e_[a-z0-9_]+$`).MatchString(os.Args[2]) {
		return fmt.Errorf("expected create/drop e2e_<schema>")
	}
	config, err := pgx.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if err != nil || config.Database != "linkbook_test" {
		return fmt.Errorf("harness requires TEST_DATABASE_URL naming linkbook_test")
	}
	db := stdlib.OpenDB(*config)
	defer func() { _ = db.Close() }()
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	var result sql.Result
	switch os.Args[1] {
	case "create":
		result, err = db.ExecContext(ctx, "CREATE SCHEMA "+os.Args[2])
	case "owner-stats":
		if len(os.Args) != 4 || !regexp.MustCompile(`^[a-f0-9-]{36}$`).MatchString(os.Args[3]) {
			return fmt.Errorf("expected owner UUID")
		}
		var links, jobs, generation int
		err = db.QueryRowContext(ctx, "SELECT count(DISTINCT l.id), count(j.id), coalesce(max(l.generation),0) FROM "+os.Args[2]+".links l LEFT JOIN "+os.Args[2]+".processing_jobs j ON j.link_id=l.id WHERE l.user_id=$1", os.Args[3]).Scan(&links, &jobs, &generation)
		if err != nil {
			return err
		}
		return json.NewEncoder(os.Stdout).Encode(map[string]int{"links": links, "jobs": jobs, "generation": generation})
	case "hold-publication", "link-stats":
		if len(os.Args) != 4 || !regexp.MustCompile(`^[a-f0-9-]{36}$`).MatchString(os.Args[3]) {
			return fmt.Errorf("expected link UUID")
		}
		config.RuntimeParams["search_path"] = os.Args[2]
		isolated := stdlib.OpenDB(*config)
		defer func() { _ = isolated.Close() }()
		if os.Args[1] == "link-stats" {
			var state, deadline string
			var jobs, executions, snapshots, assets int
			var blocked bool
			err = isolated.QueryRowContext(ctx, `SELECT
              coalesce((SELECT state FROM links WHERE id=$1),'missing'),
              coalesce((SELECT deadline_at::text FROM links WHERE id=$1),''),
              (SELECT count(*) FROM processing_jobs WHERE link_id=$1),
              coalesce((SELECT sum(executions) FROM processing_jobs WHERE link_id=$1),0),
              (SELECT count(*) FROM snapshots WHERE link_id=$1),
              (SELECT count(*) FROM assets WHERE link_id=$1),
              EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted
                AND classid=190019 AND objid::bigint=hashtext($1::text)::bit(32)::bigint
                AND database=(SELECT oid FROM pg_database WHERE datname=current_database()))`, os.Args[3]).Scan(&state, &deadline, &jobs, &executions, &snapshots, &assets, &blocked)
			if err != nil {
				return err
			}
			return json.NewEncoder(os.Stdout).Encode(map[string]any{"state": state, "deadline": deadline, "jobs": jobs, "executions": executions, "snapshots": snapshots, "assets": assets, "publicationBlocked": blocked})
		}
		// Only the harness installs this deferred trigger. It pauses COMMIT after
		// all archive writes, while another connection can verify invisibility.
		if _, err = isolated.ExecContext(ctx, `CREATE OR REPLACE FUNCTION hold_publication() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN PERFORM pg_advisory_xact_lock(190019,hashtext(NEW.link_id::text)); RETURN NEW; END $$;
          DROP TRIGGER IF EXISTS hold_publication ON snapshots;
          CREATE CONSTRAINT TRIGGER hold_publication AFTER INSERT ON snapshots
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hold_publication()`); err != nil {
			return err
		}
		conn, err := isolated.Conn(ctx)
		if err != nil {
			return err
		}
		defer func() { _ = conn.Close() }()
		if _, err = conn.ExecContext(ctx, `SELECT pg_advisory_lock(190019,hashtext($1::text))`, os.Args[3]); err != nil {
			return err
		}
		fmt.Println("ready")
		lifetime, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
		defer stop()
		<-lifetime.Done()
		return nil
	case "expire-sessions":
		if len(os.Args) != 4 || !regexp.MustCompile(`^[a-f0-9-]{36}$`).MatchString(os.Args[3]) {
			return fmt.Errorf("expected owner UUID")
		}
		result, err = db.ExecContext(ctx, "UPDATE "+os.Args[2]+".user_sessions SET expires_at=clock_timestamp() WHERE user_id=$1", os.Args[3])
	case "drop":
		result, err = db.ExecContext(ctx, "DROP SCHEMA "+os.Args[2]+" CASCADE")
	default:
		return fmt.Errorf("expected create or drop")
	}
	_ = result
	return err
}
