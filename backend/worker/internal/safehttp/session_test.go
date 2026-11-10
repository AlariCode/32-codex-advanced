package safehttp

import (
	"context"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"
)

func TestImageSessionRechecksDNSWithoutCachingResponses(t *testing.T) {
	var hits atomic.Int32
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { hits.Add(1); fmt.Fprint(w, r.URL.RawQuery) }))
	defer s.Close()
	c, lookups, dials := routedClient(t, s, []net.IPAddr{{IP: net.ParseIP("93.184.216.34").To4()}})
	scoped, closeSession := c.ImageSession()
	defer closeSession()
	for i := 0; i < 3; i++ {
		query := fmt.Sprint(i)
		body, err := scoped.FetchImage(t.Context(), "http://article.example/image?"+query)
		if err != nil || string(body) != query {
			t.Fatalf("response: %q %v", body, err)
		}
	}
	if lookups.Load() != 3 || hits.Load() != 3 || len(*dials) != 1 {
		t.Fatalf("DNS=%d requests=%d dials=%v", lookups.Load(), hits.Load(), *dials)
	}
	// An existing live connection must never bypass a newly mixed/private answer.
	scoped.lookup = func(context.Context, string) ([]net.IPAddr, error) {
		return []net.IPAddr{{IP: net.ParseIP("93.184.216.34").To4()}, {IP: net.ParseIP("127.0.0.1").To4()}}, nil
	}
	if _, err := scoped.FetchImage(t.Context(), "http://article.example/blocked"); Code(err) != "destination_blocked" {
		t.Fatal(err)
	}
	if hits.Load() != 3 || len(*dials) != 1 {
		t.Fatal("reused connection bypassed DNS policy")
	}
}

func TestImageSessionRepinsOnIPOriginAndPortChanges(t *testing.T) {
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "image") }))
	defer s.Close()
	c, _, dials := routedClient(t, s, []net.IPAddr{{IP: net.ParseIP("93.184.216.34").To4()}})
	scoped, closeSession := c.ImageSession()
	defer closeSession()
	urls := []string{"http://article.example/a", "http://article.example/b", "http://other.example/c", "http://other.example:81/d"}
	for i, u := range urls {
		if i == 1 {
			scoped.lookup = func(context.Context, string) ([]net.IPAddr, error) {
				return []net.IPAddr{{IP: net.ParseIP("93.184.216.35").To4()}}, nil
			}
		}
		if _, err := scoped.FetchImage(t.Context(), u); err != nil {
			t.Fatal(err)
		}
	}
	want := []string{"93.184.216.34:80", "93.184.216.35:80", "93.184.216.35:80", "93.184.216.35:81"}
	if fmt.Sprint(*dials) != fmt.Sprint(want) {
		t.Fatalf("pins: %v", *dials)
	}
}

func TestImageSessionScopeClosesIdleConnections(t *testing.T) {
	closed := make(chan struct{}, 4)
	s := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "image") }))
	s.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateClosed {
			closed <- struct{}{}
		}
	}
	s.Start()
	defer s.Close()
	c, _, dials := routedClient(t, s, []net.IPAddr{{IP: net.ParseIP("93.184.216.34").To4()}})
	for i := 0; i < 2; i++ {
		scoped, closeSession := c.ImageSession()
		for j := 0; j < 2; j++ {
			if _, err := scoped.FetchImage(t.Context(), "http://article.example/image"); err != nil {
				t.Fatal(err)
			}
		}
		closeSession()
		select {
		case <-closed:
		case <-time.After(2 * time.Second):
			t.Fatal("idle connection leaked beyond article")
		}
	}
	if len(*dials) != 2 {
		t.Fatalf("connections shared across articles: %v", *dials)
	}
}

func TestImageSessionLimitsRedirectCancellationAndTLS(t *testing.T) {
	var hits atomic.Int32
	entered := make(chan struct{})
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		switch r.URL.Path {
		case "/redirect":
			http.Redirect(w, r, "http://169.254.169.254/metadata", 302)
		case "/large":
			_, _ = io.CopyN(w, zeroReader{}, 2048)
		case "/wait":
			close(entered)
			<-r.Context().Done()
		default:
			fmt.Fprint(w, "image")
		}
	}))
	defer s.Close()
	c, _, dials := routedClient(t, s, []net.IPAddr{{IP: net.ParseIP("93.184.216.34").To4()}})
	scoped, closeSession := c.ImageSession()
	defer closeSession()
	if _, err := scoped.FetchImage(t.Context(), "http://article.example/ok"); err != nil {
		t.Fatal(err)
	}
	if _, err := scoped.FetchImage(t.Context(), "http://article.example/redirect"); Code(err) != "destination_blocked" || hits.Load() != 2 || len(*dials) != 1 {
		t.Fatalf("redirect: %v hits=%d dials=%v", err, hits.Load(), *dials)
	}
	data, err := scoped.FetchImageBudget(t.Context(), "http://article.example/large", 1024)
	if len(data) != 1024 || Code(err) != "image_total_limit" {
		t.Fatalf("bytes=%d err=%v", len(data), err)
	}
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	done := make(chan error, 1)
	go func() { _, err := scoped.FetchImage(ctx, "http://article.example/wait"); done <- err }()
	select {
	case <-entered:
	case <-time.After(2 * time.Second):
		t.Fatal("request not started")
	}
	cancel()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("canceled request succeeded")
		}
	case <-time.After(2 * time.Second):
		t.Fatal("cancellation did not close request")
	}
	tlsServer := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("untrusted TLS reached handler") }))
	defer tlsServer.Close()
	tlsClient, _, _ := routedClient(t, tlsServer, []net.IPAddr{{IP: net.ParseIP("93.184.216.34").To4()}})
	tlsScoped, closeTLS := tlsClient.ImageSession()
	defer closeTLS()
	if _, err := tlsScoped.FetchImage(t.Context(), "https://article.example/image"); err == nil {
		t.Fatal("untrusted TLS accepted")
	}
}

type zeroReader struct{}

func (zeroReader) Read(b []byte) (int, error) { clear(b); return len(b), nil }

// Delaying each new connection isolates the cost removed by reuse; assertions
// above verify the connection counts without relying on timing thresholds.
func BenchmarkImageConnectionSetup(b *testing.B) {
	for _, session := range []bool{false, true} {
		b.Run(fmt.Sprint("session=", session), func(b *testing.B) {
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprint(w, "image") }))
			defer s.Close()
			for i := 0; i < b.N; i++ {
				c, _ := ForFixture(s.URL)
				dial := c.dial
				c.dial = func(ctx context.Context, network, address string) (net.Conn, error) {
					time.Sleep(20 * time.Millisecond)
					return dial(ctx, network, address)
				}
				fetcher := c
				closeSession := func() {}
				if session {
					fetcher, closeSession = c.ImageSession()
				}
				for j := 0; j < 25; j++ {
					if _, err := fetcher.FetchImage(b.Context(), s.URL); err != nil {
						b.Fatal(err)
					}
				}
				closeSession()
			}
		})
	}
}
