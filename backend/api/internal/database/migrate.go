package database

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"fmt"
	"io/fs"

	"linkbook/migrations"
)

// Migrate applies each embedded SQL file once, verifying previously applied files.
func Migrate(ctx context.Context, db *sql.DB) error {
	return applyMigrations(ctx, db, migrations.Files)
}

func applyMigrations(ctx context.Context, db *sql.DB, files fs.FS) error {
	versions, err := fs.Glob(files, "*.sql")
	if err != nil {
		return fmt.Errorf("find migrations: %w", err)
	}
	if len(versions) == 0 {
		return fmt.Errorf("no SQL migrations found")
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin migration transaction: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	// A transaction-level lock also covers the initial creation of the history table.
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(734219506)"); err != nil {
		return fmt.Errorf("lock migrations: %w", err)
	}
	if _, err := tx.ExecContext(ctx, `
		CREATE TABLE IF NOT EXISTS schema_migrations (
			version TEXT PRIMARY KEY,
			checksum TEXT NOT NULL,
			applied_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
		)
	`); err != nil {
		return fmt.Errorf("create migration history: %w", err)
	}
	rows, err := tx.QueryContext(ctx, "SELECT version, checksum FROM schema_migrations ORDER BY version")
	if err != nil {
		return fmt.Errorf("read migration history: %w", err)
	}
	applied := map[string]string{}
	var lastVersion string
	for rows.Next() {
		var version, checksum string
		if err := rows.Scan(&version, &checksum); err != nil {
			_ = rows.Close()
			return fmt.Errorf("read migration version: %w", err)
		}
		applied[version] = checksum
		lastVersion = version
	}
	err = rows.Err()
	_ = rows.Close()
	if err != nil {
		return fmt.Errorf("iterate migration history: %w", err)
	}

	for _, version := range versions {
		contents, err := fs.ReadFile(files, version)
		if err != nil {
			return fmt.Errorf("read migration %s: %w", version, err)
		}
		checksum := fmt.Sprintf("%x", sha256.Sum256(contents))
		if previous, exists := applied[version]; exists {
			if previous != checksum {
				return fmt.Errorf("applied migration %s has changed", version)
			}
			delete(applied, version)
			continue
		}
		if version < lastVersion {
			return fmt.Errorf("migration %s precedes already applied %s", version, lastVersion)
		}
		if _, err := tx.ExecContext(ctx, string(contents)); err != nil {
			return fmt.Errorf("apply migration %s: %w", version, err)
		}
		if _, err := tx.ExecContext(ctx,
			"INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)", version, checksum,
		); err != nil {
			return fmt.Errorf("record migration %s: %w", version, err)
		}
	}
	if len(applied) != 0 {
		return fmt.Errorf("migration history contains files missing from this binary")
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("commit migrations: %w", err)
	}
	return nil
}
