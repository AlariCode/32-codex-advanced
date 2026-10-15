//go:build integration

package database

import (
	"testing"
	"testing/fstest"
)

func TestSnapshotsMigrationsIntegrationCleanUpgradeRestart(t *testing.T) {
	for _, upgrade := range []bool{false, true} {
		t.Run(map[bool]string{false: "clean", true: "upgrade"}[upgrade], func(t *testing.T) {
			f := newMigrationFixture(t)
			if upgrade {
				all := migrationFiles(t)
				old := fstest.MapFS{}
				for _, name := range []string{"001-create-users.sql", "002-create-user-sessions.sql", "003-create-links.sql", "004-create-processing-jobs.sql"} {
					old[name] = all[name]
				}
				if err := applyMigrations(t.Context(), f.db, old); err != nil {
					t.Fatal(err)
				}
			}
			for range 2 {
				if err := Migrate(t.Context(), f.db); err != nil {
					t.Fatal(err)
				}
			}
			var exists bool
			if err := f.db.QueryRowContext(t.Context(), `SELECT to_regclass('snapshots') IS NOT NULL`).Scan(&exists); err != nil || !exists {
				t.Fatal("missing snapshots", err)
			}
			_, err := f.db.ExecContext(t.Context(), `INSERT INTO users(id,email,password_hash) VALUES('12345678-1234-4234-8234-123456789abc','snapshots@example.com','hash'); INSERT INTO links(user_id,submitted_url,fetch_url,dedup_key,dedup_digest,dedup_slot,state) VALUES('12345678-1234-4234-8234-123456789abc','https://example.com','https://example.com','https://example.com',decode(repeat('ab',32),'hex'),0,'ready')`)
			if err == nil {
				t.Fatal("ready committed without snapshot")
			}
		})
	}
}
