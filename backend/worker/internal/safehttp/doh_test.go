package safehttp

import (
	"context"
	"encoding/base64"
	"net"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"golang.org/x/net/dns/dnsmessage"
)

func TestDoHValidatesAllAnswersBeforeDial(t *testing.T) {
	for _, mode := range []string{"public", "private", "mixed", "mapped", "fake", "malformed", "status", "redirect", "mismatch"} {
		t.Run(mode, func(t *testing.T) {
			calls := 0
			server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				calls++
				if r.Header.Get("Accept") != "application/dns-message" {
					t.Error("missing DNS accept header")
				}
				if mode == "status" {
					w.WriteHeader(503)
					return
				}
				if mode == "redirect" {
					http.Redirect(w, r, "https://127.0.0.1/", 302)
					return
				}
				if mode == "malformed" {
					_, _ = w.Write([]byte("invalid"))
					return
				}
				raw, err := base64.RawURLEncoding.DecodeString(r.URL.Query().Get("dns"))
				if err != nil {
					t.Error(err)
					return
				}
				var query dnsmessage.Message
				if query.Unpack(raw) != nil {
					t.Error("invalid wire query")
					return
				}
				reply := dnsmessage.Message{Header: dnsmessage.Header{Response: true}, Questions: query.Questions}
				if mode == "mismatch" {
					reply.Questions = nil
				}
				question := query.Questions[0]
				if question.Type == dnsmessage.TypeA {
					ip := [4]byte{93, 184, 216, 34}
					if mode == "private" {
						ip = [4]byte{127, 0, 0, 1}
					}
					if mode == "fake" {
						ip = [4]byte{198, 18, 0, 62}
					}
					reply.Answers = append(reply.Answers, dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: question.Name, Class: dnsmessage.ClassINET, Type: dnsmessage.TypeA}, Body: &dnsmessage.AResource{A: ip}})
				}
				if question.Type == dnsmessage.TypeAAAA && (mode == "mixed" || mode == "mapped") {
					var ip [16]byte
					ip[15] = 1
					if mode == "mapped" {
						ip[10] = 255
						ip[11] = 255
						ip[12] = 93
						ip[13] = 184
						ip[14] = 216
						ip[15] = 34
					}
					reply.Answers = append(reply.Answers, dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: question.Name, Class: dnsmessage.ClassINET, Type: dnsmessage.TypeAAAA}, Body: &dnsmessage.AAAAResource{AAAA: ip}})
				}
				body, err := reply.Pack()
				if err != nil {
					t.Error(err)
					return
				}
				_, _ = w.Write(body)
			}))
			defer server.Close()
			httpClient := server.Client()
			httpClient.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
			c := New()
			c.lookup = dohLookup(httpClient, server.URL)
			c.dial = func(context.Context, string, string) (net.Conn, error) {
				t.Fatal("destination check must not dial")
				return nil, nil
			}
			target, _ := url.Parse("https://article.example")
			address, err := c.destination(t.Context(), target)
			if mode == "public" {
				if err != nil || address != "93.184.216.34:443" || calls != 2 {
					t.Fatalf("public answer: %q %v calls=%d", address, err, calls)
				}
			} else if err == nil {
				t.Fatal("unsafe or invalid answer accepted")
			}
		})
	}
}

func TestDoHCancellation(t *testing.T) {
	server := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { t.Error("canceled lookup reached server") }))
	defer server.Close()
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	if _, err := dohLookup(server.Client(), server.URL)(ctx, "article.example"); err == nil {
		t.Fatal("cancellation ignored")
	}
}
