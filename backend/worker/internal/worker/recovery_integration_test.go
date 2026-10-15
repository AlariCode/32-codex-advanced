//go:build integration

package worker

import (
	"context"
	"crypto/rand"
	"database/sql"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"
	"linkbook/linkprocessing"
	"linkbook/worker/internal/safehttp"
)

type waitingFetcher struct {
	entered chan struct{}
	release chan struct{}
}

func (f waitingFetcher) Fetch(ctx context.Context, _ string) (safehttp.Page, error) {
	close(f.entered)
	select {
	case <-ctx.Done():
		return safehttp.Page{}, ctx.Err()
	case <-f.release:
		return safehttp.Page{}, context.DeadlineExceeded
	}
}
func recoveryDB(t *testing.T) *sql.DB {
	t.Helper()
	config, err := pgx.ParseConfig(os.Getenv("TEST_DATABASE_URL"))
	if err != nil || config.Database != "linkbook_test" {
		t.Fatal("requires isolated linkbook_test", err)
	}
	admin := stdlib.OpenDB(*config)
	schema := "worker_" + strings.ToLower(rand.Text())
	if _, err = admin.ExecContext(t.Context(), "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_, err := admin.ExecContext(context.Background(), "DROP SCHEMA "+schema+" CASCADE")
		if err != nil {
			t.Error(err)
		}
		_ = admin.Close()
	})
	config.RuntimeParams["search_path"] = schema
	db := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = db.Close() })
	files, err := filepath.Glob("../../../migrations/[0-9]*.sql")
	if err != nil || len(files) < 5 {
		t.Fatal("missing migrations", err)
	}
	for _, file := range files {
		b, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		if _, err = db.ExecContext(t.Context(), string(b)); err != nil {
			t.Fatal(err)
		}
	}
	return db
}
func TestRecoveryIntegrationHeartbeat(t *testing.T) {
	for _, stale := range []bool{false, true} {
		t.Run(map[bool]string{false: "current", true: "stale"}[stale], func(t *testing.T) {
			db := recoveryDB(t)
			var owner, id string
			if err := db.QueryRowContext(t.Context(), `INSERT INTO users(id,email,password_hash) VALUES(gen_random_uuid(),$1,'hash') RETURNING id::text`, strings.ToLower(url.QueryEscape(rand.Text()))+"@example.com").Scan(&owner); err != nil {
				t.Fatal(err)
			}
			if err := db.QueryRowContext(t.Context(), `INSERT INTO links(user_id,submitted_url,fetch_url,dedup_key,dedup_digest,dedup_slot) VALUES($1,'https://example.com','https://example.com','key',decode(repeat('aa',32),'hex'),0) RETURNING id::text`, owner).Scan(&id); err != nil {
				t.Fatal(err)
			}
			if _, err := db.ExecContext(t.Context(), `INSERT INTO processing_jobs(link_id,generation,deadline_at) SELECT id,generation,deadline_at FROM links WHERE id=$1`, id); err != nil {
				t.Fatal(err)
			}
			e, err := linkprocessing.Claim(t.Context(), db)
			if err != nil || e == nil {
				t.Fatal("claim", err)
			}
			var initial time.Time
			if err = db.QueryRowContext(t.Context(), `UPDATE processing_jobs SET lease_expires_at=clock_timestamp()+interval '20 seconds' WHERE link_id=$1 RETURNING lease_expires_at`, id).Scan(&initial); err != nil {
				t.Fatal(err)
			}
			fetch := waitingFetcher{make(chan struct{}), make(chan struct{})}
			done := make(chan error, 1)
			go func() { done <- process(t.Context(), db, fetch, *e) }()
			<-fetch.entered
			if stale {
				if _, err = db.ExecContext(t.Context(), `UPDATE processing_jobs SET execution_token=gen_random_uuid() WHERE link_id=$1`, id); err != nil {
					t.Fatal(err)
				}
			}
			select {
			case <-time.After(16 * time.Second):
			case err := <-done:
				if !stale {
					t.Fatalf("current work stopped %v", err)
				}
			}
			var lease time.Time
			if err = db.QueryRowContext(t.Context(), `SELECT lease_expires_at FROM processing_jobs WHERE link_id=$1`, id).Scan(&lease); err != nil {
				t.Fatal(err)
			}
			close(fetch.release)
			if !stale && !lease.After(initial) {
				t.Fatal("lease not renewed during fetch")
			}
			if stale && !lease.Equal(initial) {
				t.Fatal("stale token renewed lease")
			}
		})
	}
}
