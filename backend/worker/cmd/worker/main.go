package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"linkbook/worker/internal/worker"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stderr, nil)))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := worker.Run(ctx); err != nil && ctx.Err() == nil {
		slog.Error("Worker stopped", "outcome", "error")
		os.Exit(1)
	}
}
