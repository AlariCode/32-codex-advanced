package main

import (
	"context"
	"os"
	"os/signal"
	"syscall"

	"linkbook/worker/internal/worker"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	worker.Run(ctx)
}
