package safehttp

import (
	"context"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestTransientRetries(t *testing.T) {
	for _, status := range []int{429, 500, 503} {
		t.Run(http.StatusText(status), func(t *testing.T) {
			var calls atomic.Int32
			start := time.Now()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if calls.Add(1) < 3 {
					w.Header().Set("Retry-After", "1")
					w.WriteHeader(status)
					return
				}
				w.Header().Set("Content-Type", "text/html")
				_, _ = w.Write([]byte("<p>Recovered</p>"))
			}))
			defer server.Close()
			c, err := ForFixture(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			ctx, cancel := context.WithTimeout(t.Context(), 8*time.Second)
			defer cancel()
			page, err := c.Fetch(ctx, server.URL)
			if err != nil || string(page.HTML) != "<p>Recovered</p>" || calls.Load() != 3 {
				t.Fatalf("retry result %q %v, calls=%d", page.HTML, err, calls.Load())
			}
			if time.Since(start) < 2*time.Second {
				t.Fatal("Retry-After ignored")
			}
		})
	}
}
func TestRetriesBoundedByBudgetAndAttempts(t *testing.T) {
	for _, after := range []string{"0", "120", time.Now().Add(120 * time.Second).UTC().Format(http.TimeFormat)} {
		t.Run(after, func(t *testing.T) {
			var calls atomic.Int32
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls.Add(1)
				w.Header().Set("Retry-After", after)
				w.WriteHeader(503)
			}))
			defer server.Close()
			c, _ := ForFixture(server.URL)
			ctx, cancel := context.WithTimeout(t.Context(), 2500*time.Millisecond)
			defer cancel()
			start := time.Now()
			_, err := c.Fetch(ctx, server.URL)
			if err == nil || calls.Load() > 5 || time.Since(start) > 3*time.Second {
				t.Fatalf("unbounded retries %d %v", calls.Load(), err)
			}
			if after == "0" && calls.Load() < 2 {
				t.Fatal("transient failure never retried")
			}
			if after != "0" && calls.Load() != 1 {
				t.Fatal("retried before Retry-After")
			}
		})
	}
}
func TestPermanentHTTPFailureNotRetried(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(404) }))
	defer server.Close()
	c, _ := ForFixture(server.URL)
	_, err := c.Fetch(t.Context(), server.URL)
	if Code(err) != "http_error" || calls.Load() != 1 {
		t.Fatalf("permanent error retried: %d %v", calls.Load(), err)
	}
}
