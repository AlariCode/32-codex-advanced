package safehttp

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
)

func TestRetryAttemptLimit(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { calls.Add(1); w.WriteHeader(503) }))
	defer server.Close()
	client, _ := ForFixture(server.URL)
	_, err := client.Fetch(t.Context(), server.URL)
	if Code(err) != "http_error" || calls.Load() != 5 {
		t.Fatalf("attempt limit: calls=%d err=%v", calls.Load(), err)
	}
}
func TestRetryTransientConnectionClosed(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if calls.Add(1) < 3 {
			connection, _, err := w.(http.Hijacker).Hijack()
			if err != nil {
				t.Error(err)
				return
			}
			_ = connection.Close()
			return
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = w.Write([]byte("Recovered connection"))
	}))
	defer server.Close()
	client, _ := ForFixture(server.URL)
	page, err := client.Fetch(t.Context(), server.URL)
	if err != nil || string(page.HTML) != "Recovered connection" || calls.Load() != 3 {
		t.Fatalf("connection retry: calls=%d err=%v", calls.Load(), err)
	}
}
