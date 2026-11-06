package worker

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"strings"
	"testing"
	"time"

	"linkbook/linkprocessing"
	"linkbook/worker/internal/safehttp"
)

func captureObservations(t *testing.T) *bytes.Buffer {
	t.Helper()
	var output bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	t.Cleanup(func() { slog.SetDefault(old) })
	return &output
}
func observationEvents(t *testing.T, output *bytes.Buffer, secrets ...string) []map[string]any {
	t.Helper()
	for _, secret := range secrets {
		if secret != "" && strings.Contains(output.String(), secret) {
			t.Fatal("sensitive data in observations")
		}
	}
	var events []map[string]any
	scanner := bufio.NewScanner(bytes.NewReader(output.Bytes()))
	for scanner.Scan() {
		var event map[string]any
		if err := json.Unmarshal(scanner.Bytes(), &event); err != nil {
			t.Fatal(err)
		}
		events = append(events, event)
	}
	if err := scanner.Err(); err != nil {
		t.Fatal(err)
	}
	return events
}

type stoppedObservationFetcher struct{}

func (stoppedObservationFetcher) Fetch(ctx context.Context, _ string) (safehttp.Page, error) {
	return safehttp.Page{}, ctx.Err()
}

func TestProcessObservesCancellationAndDeadline(t *testing.T) {
	for _, outcome := range []string{"canceled", "deadline"} {
		t.Run(outcome, func(t *testing.T) {
			output := captureObservations(t)
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			e := linkprocessing.Execution{JobID: "job", LinkID: "link", Generation: 1, Number: 2, Token: "SECRET-token", FetchURL: "https://example.com/SECRET-url", Deadline: time.Now().Add(time.Minute)}
			wantErr := context.Canceled
			if outcome == "canceled" {
				cancel()
			} else {
				e.Deadline = time.Now().Add(-time.Second)
				wantErr = context.DeadlineExceeded
			}
			// These attempts must stop before touching the database or publishing.
			if err := process(ctx, nil, stoppedObservationFetcher{}, e); !errors.Is(err, wantErr) {
				t.Fatalf("error: %v", err)
			}
			events := observationEvents(t, output, "SECRET")
			if len(events) != 2 {
				t.Fatalf("events: %v", events)
			}
			for i, event := range events {
				stage := []string{"html", "attempt"}[i]
				if event["stage"] != stage || event["outcome"] != outcome || event["execution"] != float64(2) || event["duration_ms"].(float64) < 0 {
					t.Fatalf("event: %v", event)
				}
			}
		})
	}
}
