//go:build integration

package database

import (
	"testing"
	"testing/fstest"
)

func TestLibraryMigrationsIntegrationCleanUpgradeRestart(t *testing.T) {
	for _, upgrade := range []bool{false, true} {
		t.Run(map[bool]string{false: "clean", true: "upgrade"}[upgrade], func(t *testing.T) {
			f := newMigrationFixture(t)
			if upgrade {
				all := migrationFiles(t)
				old := fstest.MapFS{"001-create-users.sql": all["001-create-users.sql"], "002-create-user-sessions.sql": all["002-create-user-sessions.sql"]}
				if err := applyMigrations(t.Context(), f.db, old); err != nil {
					t.Fatal(err)
				}
				if _, err := f.db.ExecContext(t.Context(), `INSERT INTO users(id,email,password_hash) VALUES('12345678-1234-4234-8234-123456789abc','existing@example.com','hash'); INSERT INTO user_sessions(token_hash,user_id,expires_at) VALUES(decode(repeat('ab',32),'hex'),'12345678-1234-4234-8234-123456789abc',now()+interval '1 day')`); err != nil {
					t.Fatal(err)
				}
			}
			for range 2 {
				if err := Migrate(t.Context(), f.db); err != nil {
					t.Fatal(err)
				}
			}
			for _, table := range []string{"links", "processing_jobs"} {
				var exists bool
				if err := f.db.QueryRowContext(t.Context(), "SELECT to_regclass($1) IS NOT NULL", table).Scan(&exists); err != nil {
					t.Fatal(err)
				}
				if !exists {
					t.Errorf("missing table %s", table)
				}
			}
			if upgrade {
				var count int
				if err := f.db.QueryRowContext(t.Context(), "SELECT count(*) FROM users JOIN user_sessions ON users.id=user_sessions.user_id WHERE email='existing@example.com'").Scan(&count); err != nil {
					t.Fatal(err)
				}
				if count != 1 {
					t.Fatal("upgrade lost existing user/session")
				}
			}
		})
	}
}
