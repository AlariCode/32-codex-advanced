//go:build integration

package database

import (
	"context"
	"crypto/rand"
	"database/sql"
	"io/fs"
	"net/url"
	"os"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/stdlib"

	"linkbook/migrations"
)

type migrationFixture struct {
	db  *sql.DB
	dsn string
}

func newMigrationFixture(t *testing.T) migrationFixture {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		t.Fatal("TEST_DATABASE_URL is required; start PostgreSQL with make test-db-up")
	}
	config, err := pgx.ParseConfig(dsn)
	if err != nil {
		t.Fatalf("parse test database configuration: %v", err)
	}
	if config.Database != "linkbook_test" {
		t.Fatal("migration tests require the dedicated linkbook_test database")
	}
	scopedURL, err := url.Parse(dsn)
	if err != nil {
		t.Fatalf("parse test database URL: %v", err)
	}
	if scopedURL.Scheme != "postgres" && scopedURL.Scheme != "postgresql" {
		t.Fatal("TEST_DATABASE_URL must be a PostgreSQL URL")
	}
	admin := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = admin.Close() })
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	defer cancel()
	schema := "migration_" + strings.ToLower(rand.Text())
	if _, err := admin.ExecContext(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatalf("create migration test schema: %v", err)
	}
	t.Cleanup(func() {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if _, err := admin.ExecContext(ctx, "DROP SCHEMA "+schema+" CASCADE"); err != nil {
			t.Errorf("remove migration test schema: %v", err)
		}
	})
	query := scopedURL.Query()
	query.Set("search_path", schema)
	scopedURL.RawQuery = query.Encode()
	config, err = pgx.ParseConfig(scopedURL.String())
	if err != nil {
		t.Fatal(err)
	}
	db := stdlib.OpenDB(*config)
	t.Cleanup(func() { _ = db.Close() })
	return migrationFixture{db: db, dsn: scopedURL.String()}
}

func TestMigrationsIntegrationStartupAndRestart(t *testing.T) {
	fixture := newMigrationFixture(t)
	first, err := Open(t.Context(), fixture.dsn)
	if err != nil {
		t.Fatalf("first startup: %v", err)
	}
	if _, err := first.ExecContext(t.Context(), `
		INSERT INTO users (id, email, password_hash)
		VALUES ('12345678-1234-4234-8234-123456789abc', 'reader@example.com', 'existing-hash')
	`); err != nil {
		_ = first.Close()
		t.Fatal(err)
	}
	_ = first.Close()
	second, err := Open(t.Context(), fixture.dsn)
	if err != nil {
		t.Fatalf("restart: %v", err)
	}
	defer func() { _ = second.Close() }()
	var count int
	if err := second.QueryRowContext(t.Context(), "SELECT count(*) FROM schema_migrations").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if want := len(migrationFiles(t)); count != want {
		t.Errorf("migration history contains %d entries, want %d", count, want)
	}
	var hash string
	if err := second.QueryRowContext(t.Context(),
		"SELECT password_hash FROM users WHERE email = 'reader@example.com'",
	).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if hash != "existing-hash" {
		t.Error("API restart changed an existing user")
	}
}

func TestMigrationsIntegrationConcurrentStartup(t *testing.T) {
	fixture := newMigrationFixture(t)
	results := make(chan error, 2)
	start := make(chan struct{})
	var group sync.WaitGroup
	for range 2 {
		group.Go(func() {
			<-start
			db, err := Open(t.Context(), fixture.dsn)
			if err == nil {
				_ = db.Close()
			}
			results <- err
		})
	}
	close(start)
	group.Wait()
	close(results)
	for err := range results {
		if err != nil {
			t.Errorf("concurrent startup: %v", err)
		}
	}
	var count int
	if err := fixture.db.QueryRowContext(t.Context(), "SELECT count(*) FROM schema_migrations").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if want := len(migrationFiles(t)); count != want {
		t.Errorf("migration history contains %d entries, want %d", count, want)
	}
}

func TestMigrationsIntegrationFailedBatchRollsBack(t *testing.T) {
	fixture := newMigrationFixture(t)
	files := fstest.MapFS{
		"001-good.sql": &fstest.MapFile{Data: []byte("CREATE TABLE marker (id INT PRIMARY KEY)")},
		"002-bad.sql":  &fstest.MapFile{Data: []byte("SELECT * FROM nonexistent_table")},
	}
	if err := applyMigrations(t.Context(), fixture.db, files); err == nil {
		t.Fatal("invalid SQL migration must fail")
	}
	for _, table := range []string{"marker", "schema_migrations"} {
		assertTableMissing(t, fixture.db, table)
	}
	delete(files, "002-bad.sql")
	if err := applyMigrations(t.Context(), fixture.db, files); err != nil {
		t.Fatalf("retry after rollback: %v", err)
	}
}

func migrationFiles(t *testing.T) fstest.MapFS {
	t.Helper()
	versions, err := fs.Glob(migrations.Files, "*.sql")
	if err != nil {
		t.Fatal(err)
	}
	files := fstest.MapFS{}
	for _, version := range versions {
		contents, err := migrations.Files.ReadFile(version)
		if err != nil {
			t.Fatal(err)
		}
		files[version] = &fstest.MapFile{Data: contents}
	}
	return files
}

func assertTableMissing(t *testing.T, db *sql.DB, name string) {
	t.Helper()
	var table sql.NullString
	if err := db.QueryRowContext(t.Context(), "SELECT to_regclass($1)::text", name).Scan(&table); err != nil {
		t.Fatal(err)
	}
	if table.Valid {
		t.Errorf("table %s still exists after failed migration", name)
	}
}

func TestMigrationsIntegrationUpgradeRollsBack(t *testing.T) {
	fixture := newMigrationFixture(t)
	if err := Migrate(t.Context(), fixture.db); err != nil {
		t.Fatal(err)
	}
	if _, err := fixture.db.ExecContext(t.Context(), `
		INSERT INTO users (id, email, password_hash)
		VALUES ('12345678-1234-4234-8234-123456789abc', 'reader@example.com', 'existing-hash')
	`); err != nil {
		t.Fatal(err)
	}
	files := migrationFiles(t)
	files["999-bad.sql"] = &fstest.MapFile{Data: []byte("CREATE TABLE marker (id INT); SELECT * FROM missing_table")}
	if err := applyMigrations(t.Context(), fixture.db, files); err == nil {
		t.Fatal("invalid upgrade must fail")
	}
	assertTableMissing(t, fixture.db, "marker")
	var count int
	if err := fixture.db.QueryRowContext(t.Context(), "SELECT count(*) FROM schema_migrations").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != len(migrationFiles(t)) {
		t.Error("failed upgrade changed migration history")
	}
	var hash string
	if err := fixture.db.QueryRowContext(t.Context(),
		"SELECT password_hash FROM users WHERE email = 'reader@example.com'",
	).Scan(&hash); err != nil {
		t.Fatal(err)
	}
	if hash != "existing-hash" {
		t.Error("failed upgrade changed an existing user")
	}
}

func TestMigrationsIntegrationAppliesNewVersionOnce(t *testing.T) {
	fixture := newMigrationFixture(t)
	if err := Migrate(t.Context(), fixture.db); err != nil {
		t.Fatal(err)
	}
	files := migrationFiles(t)
	files["999-marker.sql"] = &fstest.MapFile{Data: []byte("CREATE TABLE marker (id INT PRIMARY KEY)")}
	for range 2 {
		if err := applyMigrations(t.Context(), fixture.db, files); err != nil {
			t.Fatalf("apply new version: %v", err)
		}
	}
	var count int
	if err := fixture.db.QueryRowContext(t.Context(), "SELECT count(*) FROM schema_migrations").Scan(&count); err != nil {
		t.Fatal(err)
	}
	if want := len(files); count != want {
		t.Errorf("migration history contains %d entries, want %d", count, want)
	}
}

func TestMigrationsIntegrationRejectsChangedFile(t *testing.T) {
	fixture := newMigrationFixture(t)
	if err := Migrate(t.Context(), fixture.db); err != nil {
		t.Fatal(err)
	}
	files := migrationFiles(t)
	files["001-create-users.sql"].Data = append(files["001-create-users.sql"].Data, []byte("\n-- changed")...)
	err := applyMigrations(t.Context(), fixture.db, files)
	if err == nil || !strings.Contains(err.Error(), "has changed") {
		t.Fatalf("changed migration must be rejected, got: %v", err)
	}
}

func TestMigrationsIntegrationRejectsMissingFile(t *testing.T) {
	fixture := newMigrationFixture(t)
	files := migrationFiles(t)
	files["999-marker.sql"] = &fstest.MapFile{Data: []byte("CREATE TABLE marker (id INT PRIMARY KEY)")}
	if err := applyMigrations(t.Context(), fixture.db, files); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(t.Context(), fixture.db); err == nil || !strings.Contains(err.Error(), "missing") {
		t.Fatalf("missing applied migration must be rejected, got: %v", err)
	}
}

func TestMigrationsIntegrationRejectsOutOfOrderVersion(t *testing.T) {
	fixture := newMigrationFixture(t)
	if err := Migrate(t.Context(), fixture.db); err != nil {
		t.Fatal(err)
	}
	files := migrationFiles(t)
	files["000-old.sql"] = &fstest.MapFile{Data: []byte("CREATE TABLE marker (id INT PRIMARY KEY)")}
	if err := applyMigrations(t.Context(), fixture.db, files); err == nil || !strings.Contains(err.Error(), "precedes") {
		t.Fatalf("out of order migration must be rejected, got: %v", err)
	}
	assertTableMissing(t, fixture.db, "marker")
}
