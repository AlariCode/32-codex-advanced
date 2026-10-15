// integration-db manages only isolated harness schemas in linkbook_test.
package main

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"regexp"
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
	case "expire-sessions":
		if len(os.Args) != 4 || !regexp.MustCompile(`^[a-f0-9-]{36}$`).MatchString(os.Args[3]) {
			return fmt.Errorf("expected owner UUID")
		}
		result, err = db.ExecContext(ctx, "UPDATE "+os.Args[2]+".user_sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE user_id=$1", os.Args[3])
	case "drop":
		result, err = db.ExecContext(ctx, "DROP SCHEMA "+os.Args[2]+" CASCADE")
	default:
		return fmt.Errorf("expected create or drop")
	}
	_ = result
	return err
}
