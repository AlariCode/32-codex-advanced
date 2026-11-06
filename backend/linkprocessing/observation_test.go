package linkprocessing

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestObservationSafeCorrelationAndOutcomes(t *testing.T) {
	var output bytes.Buffer
	old := slog.Default()
	slog.SetDefault(slog.New(slog.NewJSONHandler(&output, nil)))
	defer slog.SetDefault(old)
	secret := "SECRET-session-password-dsn-url-query-article"
	e := Execution{JobID: "job", LinkID: "link", Generation: 2, Number: 3, Token: secret, FetchURL: "https://example.com/?token=" + secret}
	for _, tc := range []struct {
		err  error
		want string
	}{
		{nil, "ok"}, {errors.New(secret), "error"},
		{fmt.Errorf("%s: %w", secret, context.Canceled), "canceled"},
		{fmt.Errorf("%s: %w", secret, context.DeadlineExceeded), "deadline"},
	} {
		output.Reset()
		e.Stage("html", ErrorOutcome(tc.err), time.Now().Add(-time.Second))
		if strings.Contains(output.String(), secret) {
			t.Fatal("sensitive data logged")
		}
		var event map[string]any
		if err := json.Unmarshal(output.Bytes(), &event); err != nil {
			t.Fatal(err)
		}
		if event["outcome"] != tc.want || event["execution"] != float64(3) || event["generation"] != float64(2) || event["job_id"] != "job" || event["duration_ms"].(float64) < 1000 {
			t.Fatalf("bad event: %v", event)
		}
	}
}
