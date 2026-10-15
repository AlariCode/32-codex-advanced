//go:build integration

package safehttp

import (
	"context"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"golang.org/x/net/dns/dnsmessage"
)

// This supplementary integration check sends actual A/AAAA DNS packets to a
// controlled UDP resolver. HTTP uses a real TCP fixture and observes the exact
// public destination handed to the dialer; no URL-validator result is mocked.
func TestDNSIntegrationMixedAnswersAndRebinding(t *testing.T) {
	for _, mode := range []string{"mixed", "mapped", "rebind"} {
		t.Run(mode, func(t *testing.T) {
			udp, err := net.ListenPacket("udp", "127.0.0.1:0")
			if err != nil {
				t.Fatal(err)
			}
			defer udp.Close()
			var resolutions, hits, dials atomic.Int32
			done := make(chan struct{})
			defer close(done)
			go func() {
				buffer := make([]byte, 4096)
				for {
					n, peer, err := udp.ReadFrom(buffer)
					if err != nil {
						return
					}
					var query dnsmessage.Message
					if query.Unpack(buffer[:n]) != nil || len(query.Questions) != 1 {
						continue
					}
					question := query.Questions[0]
					reply := dnsmessage.Message{Header: dnsmessage.Header{ID: query.ID, Response: true, Authoritative: true, RecursionAvailable: true}, Questions: query.Questions}
					if question.Type == dnsmessage.TypeA {
						count := resolutions.Add(1)
						ip := [4]byte{93, 184, 216, 34}
						if mode == "rebind" && count > 1 {
							ip = [4]byte{127, 0, 0, 1}
						}
						if mode != "mapped" {
							reply.Answers = append(reply.Answers, dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: question.Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET, TTL: 0}, Body: &dnsmessage.AResource{A: ip}})
						}
						if mode == "mixed" {
							reply.Answers = append(reply.Answers, dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: question.Name, Type: dnsmessage.TypeA, Class: dnsmessage.ClassINET}, Body: &dnsmessage.AResource{A: [4]byte{127, 0, 0, 1}}})
						}
					}
					if mode == "mapped" && question.Type == dnsmessage.TypeAAAA {
						var address [16]byte
						address[10] = 255
						address[11] = 255
						copy(address[12:], []byte{93, 184, 216, 34})
						reply.Answers = append(reply.Answers, dnsmessage.Resource{Header: dnsmessage.ResourceHeader{Name: question.Name, Type: dnsmessage.TypeAAAA, Class: dnsmessage.ClassINET}, Body: &dnsmessage.AAAAResource{AAAA: address}})
					}
					raw, err := reply.Pack()
					if err == nil {
						_, _ = udp.WriteTo(raw, peer)
					}
					select {
					case <-done:
						return
					default:
					}
				}
			}()
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				hits.Add(1)
				if mode == "rebind" {
					http.Redirect(w, r, "http://dns-fixture.example/again", 302)
					return
				}
				w.Header().Set("Content-Type", "text/html")
				_, _ = io.WriteString(w, "<p>unexpected</p>")
			}))
			defer server.Close()
			resolver := &net.Resolver{PreferGo: true, Dial: func(ctx context.Context, network, address string) (net.Conn, error) {
				return (&net.Dialer{}).DialContext(ctx, "udp", udp.LocalAddr().String())
			}}
			client := New()
			client.lookup = func(ctx context.Context, host string) ([]net.IPAddr, error) {
				ips, err := resolver.LookupNetIP(ctx, "ip", host)
				out := []net.IPAddr{}
				for _, ip := range ips {
					out = append(out, net.IPAddr{IP: net.IP(ip.AsSlice())})
				}
				return out, err
			}
			client.dial = func(ctx context.Context, network, address string) (net.Conn, error) {
				dials.Add(1)
				if address != "93.184.216.34:80" {
					t.Errorf("dial escaped validated public IP: %s", address)
				}
				return (&net.Dialer{}).DialContext(ctx, network, strings.TrimPrefix(server.URL, "http://"))
			}
			if _, err := client.Fetch(t.Context(), "http://dns-fixture.example/start"); Code(err) != "destination_blocked" {
				t.Fatalf("DNS policy: %v", err)
			}
			want := int32(0)
			if mode == "rebind" {
				want = 1
			}
			if hits.Load() != want || dials.Load() != want {
				t.Fatalf("forbidden socket reached: hits=%d dials=%d", hits.Load(), dials.Load())
			}
		})
	}
}
