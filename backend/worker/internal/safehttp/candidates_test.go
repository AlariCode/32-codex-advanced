package safehttp

import (
	"context"
	"linkbook/linkprocessing"
	"net"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestCandidatesAndBaseNeverBypassPinnedPolicy(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "http://169.254.169.254/metadata", 302)
			return
		}
		w.WriteHeader(200)
	}))
	defer s.Close()
	c, _, dials := routedClient(t, s, []net.IPAddr{{IP: net.IP{93, 184, 216, 34}}})
	for _, raw := range []string{"http://127.0.0.1/image", "http://169.254.169.254/image", "http://[::ffff:127.0.0.1]/image", "http://article.example/redirect"} {
		before := len(*dials)
		_, err := c.FetchImage(t.Context(), raw)
		wantDials := 0
		if raw == "http://article.example/redirect" {
			wantDials = 1
		}
		if Code(err) != "destination_blocked" || len(*dials)-before != wantDials {
			t.Fatalf("candidate connected: %s %v dials=%v", raw, err, *dials)
		}
	}
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	before := len(*dials)
	_, _ = c.FetchImage(ctx, "http://article.example/cancelled")
	if len(*dials) != before {
		t.Fatal("dial after deadline")
	}
}
func TestImageRemainingDownloadBudget(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write(make([]byte, linkprocessing.MaxImageBytes))
	}))
	defer s.Close()
	c, _ := ForFixture(s.URL)
	data, err := c.FetchImageBudget(t.Context(), s.URL, 1024)
	if len(data) > 1024 || Code(err) != "image_total_limit" {
		t.Fatalf("remaining bytes: %d %v", len(data), err)
	}
}
