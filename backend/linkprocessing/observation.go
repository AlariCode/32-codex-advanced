package linkprocessing

import (
	"context"
	"errors"
	"log/slog"
	"time"
)

// Log emits only correlation IDs and caller-selected numeric/classification
// fields. Never pass an Execution, Result, URL, token or raw error as a field.
func (e Execution) Log(event string, fields ...any) {
	attrs := []any{"job_id", e.JobID, "link_id", e.LinkID, "generation", e.Generation, "execution", e.Number}
	slog.Info(event, append(attrs, fields...)...)
}

// ErrorOutcome deliberately discards error messages, which can contain URLs,
// database credentials, SQL detail or article content.
func ErrorOutcome(err error) string {
	switch {
	case errors.Is(err, context.DeadlineExceeded):
		return "deadline"
	case errors.Is(err, context.Canceled):
		return "canceled"
	case err != nil:
		return "error"
	default:
		return "ok"
	}
}

func (e Execution) Stage(stage, outcome string, started time.Time) {
	e.Log("archive_stage", "stage", stage, "outcome", outcome, "duration_ms", float64(time.Since(started))/float64(time.Millisecond))
}
