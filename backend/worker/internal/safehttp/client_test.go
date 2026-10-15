package safehttp

import (
	"bytes"
	"compress/gzip"
	"context"
	"crypto/tls"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestProductionRejectsPrivateDestinationsBeforeConnection(t *testing.T) {
	var hits atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1) }))
	defer server.Close()
	for _, target := range []string{server.URL, "http://10.0.0.1/", "http://169.254.169.254/latest/meta-data", "http://[::1]/", "http://[::ffff:127.0.0.1]/", "http://100.100.100.200/", "http://192.0.0.1/", "http://0.0.0.0/", "http://[64:ff9b::7f00:1]/", "http://user:secret@example.com/", "file:///etc/passwd", "http://2130706433/"} {
		t.Run(target, func(t *testing.T) {
			if _, err := New().Fetch(t.Context(), target); Code(err) != "destination_blocked" {
				t.Fatalf("got %v", err)
			}
		})
	}
	if hits.Load() != 0 {
		t.Fatal("blocked destination contacted")
	}
}

// DNS and socket routing are controlled independently: HTTP/TLS and redirects
// use real sockets, while the dial seam records the exact IP selected by policy.
func routedClient(t *testing.T, server *httptest.Server, answers []net.IPAddr) (*Client, *atomic.Int32, *[]string) {
	t.Helper()
	c := New()
	var lookups atomic.Int32
	dials := []string{}
	c.lookup = func(ctx context.Context, host string) ([]net.IPAddr, error) { lookups.Add(1); return answers, nil }
	c.dial = func(ctx context.Context, network, address string) (net.Conn, error) {
		dials = append(dials, address)
		return (&net.Dialer{}).DialContext(ctx, network, strings.TrimPrefix(strings.TrimPrefix(server.URL, "http://"), "https://"))
	}
	return c, &lookups, &dials
}
func TestMixedDNSAndMappedIPv6PreventAnyConnection(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("forbidden connection") }))
	defer s.Close()
	for _, answers := range [][]net.IPAddr{
		{{IP: net.ParseIP("93.184.216.34")}, {IP: net.ParseIP("127.0.0.1")}},
		{{IP: net.ParseIP("::ffff:93.184.216.34")}},
		{{IP: net.ParseIP("169.254.169.254")}},
	} {
		c, _, dials := routedClient(t, s, answers)
		if _, err := c.Fetch(t.Context(), "http://article.example/"); Code(err) != "destination_blocked" || len(*dials) != 0 {
			t.Fatalf("mixed/mapped DNS reached socket: %v %v", err, *dials)
		}
	}
}
func TestPinnedConnectionHTTPHostAndRebindingRedirect(t *testing.T) {
	var hits atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		if r.Host != "article.example" || r.Header.Get("Cookie") != "" {
			t.Error("Host/cookies violated")
		}
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "http://article.example/private", 302)
			return
		}
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, "<p>complete</p>")
	}))
	defer s.Close()
	t.Setenv("HTTP_PROXY", "http://127.0.0.1:1")
	c, calls, dials := routedClient(t, s, []net.IPAddr{{IP: net.IP{93, 184, 216, 34}}})
	doc, err := c.Fetch(t.Context(), "http://article.example/article")
	if err != nil || doc.FinalURL != "http://article.example/article" || string(doc.HTML) != "<p>complete</p>" || calls.Load() != 1 || len(*dials) != 1 || (*dials)[0] != "93.184.216.34:80" {
		t.Fatalf("pinning: %v %v %v", doc, err, *dials)
	}
	c.lookup = func(ctx context.Context, host string) ([]net.IPAddr, error) {
		if calls.Add(1) > 2 {
			return []net.IPAddr{{IP: net.IP{127, 0, 0, 1}}}, nil
		}
		return []net.IPAddr{{IP: net.IP{93, 184, 216, 34}}}, nil
	}
	if _, err = c.Fetch(t.Context(), "http://article.example/redirect"); Code(err) != "destination_blocked" {
		t.Fatal("rebinding redirect accepted", err)
	}
	if hits.Load() != 2 || len(*dials) != 2 {
		t.Fatalf("redirect made forbidden connection: hits=%d dials=%v", hits.Load(), *dials)
	}
}
func TestRedirectToPrivateNeverConnects(t *testing.T) {
	var blocked atomic.Int32
	sink := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { blocked.Add(1) }))
	defer sink.Close()
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { http.Redirect(w, r, sink.URL, 302) }))
	defer s.Close()
	c, _, dials := routedClient(t, s, []net.IPAddr{{IP: net.IP{93, 184, 216, 34}}})
	if _, err := c.Fetch(t.Context(), "http://article.example/"); Code(err) != "destination_blocked" || blocked.Load() != 0 || len(*dials) != 1 {
		t.Fatal("private redirect connected", err)
	}
}
func TestTLSUsesOriginalServerName(t *testing.T) {
	var name string
	s := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		_, _ = io.WriteString(w, "<p>tls</p>")
	}))
	s.TLS = &tls.Config{GetConfigForClient: func(hello *tls.ClientHelloInfo) (*tls.Config, error) { name = hello.ServerName; return nil, nil }}
	s.StartTLS()
	defer s.Close()
	c, _, dials := routedClient(t, s, []net.IPAddr{{IP: net.IP{93, 184, 216, 34}}})
	// The fixture certificate is untrusted. The handshake must still send the
	// original DNS name, and fail verification rather than disabling TLS checks.
	if _, err := c.Fetch(t.Context(), "https://article.example/"); err == nil {
		t.Fatal("untrusted TLS accepted")
	}
	if name != "article.example" || len(*dials) != 1 || (*dials)[0] != "93.184.216.34:443" {
		t.Fatalf("wrong TLS identity: %q %v", name, *dials)
	}
}
func TestDecompressedBodyHeadersRedirectAndBudgetLimits(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html")
		switch r.URL.Path {
		case "/gzip":
			w.Header().Set("Content-Encoding", "gzip")
			z := gzip.NewWriter(w)
			_, _ = io.Copy(z, bytes.NewReader(bytes.Repeat([]byte("x"), 3*1024*1024+1)))
			_ = z.Close()
		case "/headers":
			w.Header().Set("X-Large", strings.Repeat("a", 80*1024))
		case "/loop":
			http.Redirect(w, r, "/loop", 302)
		case "/slow":
			<-r.Context().Done()
		default:
			_, _ = io.WriteString(w, "<p>ok</p>")
		}
	}))
	defer s.Close()
	for path, code := range map[string]string{"/gzip": "html_too_large", "/headers": "network_error", "/loop": "redirect_limit", "/slow": "network_error"} {
		c, _, _ := routedClient(t, s, []net.IPAddr{{IP: net.IP{93, 184, 216, 34}}})
		ctx, cancel := context.WithTimeout(t.Context(), 200*time.Millisecond)
		_, err := c.Fetch(ctx, "http://article.example"+path+"?secret=do-not-leak")
		cancel()
		if Code(err) != code || strings.Contains(err.Error(), "secret") {
			t.Fatalf("%s: %v want %s", path, err, code)
		}
	}
}
