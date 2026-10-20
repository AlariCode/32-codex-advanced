//go:build integration

package database

import (
	"testing"
	"testing/fstest"
)

func TestAssetsMigrationsIntegrationCleanUpgradeRestart(t *testing.T) {
	for _, upgrade := range []bool{false, true} {
		t.Run(map[bool]string{false: "clean", true: "upgrade"}[upgrade], func(t *testing.T) {
			f := newMigrationFixture(t)
			if upgrade {
				old := fstest.MapFS{}
				for name, file := range migrationFiles(t) {
					if name < "006" {
						old[name] = file
					}
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
			if err := f.db.QueryRowContext(t.Context(), `SELECT to_regclass('assets') IS NOT NULL`).Scan(&exists); err != nil || !exists {
				t.Fatal("assets missing", err)
			}
		})
	}
}
