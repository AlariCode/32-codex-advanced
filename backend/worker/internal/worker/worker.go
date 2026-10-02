package worker

import (
	"context"
	"log/slog"
)

func Run(ctx context.Context) {
	slog.Info("Worker started; link processing is not configured yet")
	<-ctx.Done()
	slog.Info("Worker stopped gracefully")
}
