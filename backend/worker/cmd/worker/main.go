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
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := worker.Run(ctx); err != nil && ctx.Err() == nil {
		slog.Error("Worker stopped", "error", err)
		os.Exit(1)
	}
}
