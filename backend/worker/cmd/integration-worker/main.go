// This harness-only binary is never packaged in the production worker image.
package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/jackc/pgx/v5"
	"linkbook/worker/internal/safehttp"
	"linkbook/worker/internal/worker"
)

func main() {
	config, err := pgx.ParseConfig(os.Getenv("DATABASE_URL"))
	if err != nil || config.Database != "linkbook_test" {
		slog.Error("Integration worker requires isolated linkbook_test")
		os.Exit(1)
	}
	if config.RuntimeParams["search_path"] == "" {
		slog.Error("Integration worker requires an isolated schema")
		os.Exit(1)
	}
	client, err := safehttp.ForFixture(os.Getenv("FIXTURE_ORIGIN"))
	if err != nil {
		slog.Error("Invalid fixture origin")
		os.Exit(1)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err = worker.RunWith(ctx, os.Getenv("DATABASE_URL"), client); err != nil && ctx.Err() == nil {
		slog.Error("Integration worker failed", "error", err)
		os.Exit(1)
	}
}
