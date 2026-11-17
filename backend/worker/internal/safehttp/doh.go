package safehttp

import (
	"context"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"time"

	"golang.org/x/net/dns/dnsmessage"
)

// NewWithDNSOverHTTPS avoids local Fake IP DNS without relaxing destination
// validation. The resolver uses a public IP so it needs no bootstrap DNS.
func NewWithDNSOverHTTPS() *Client {
	c := New()
	resolver := &http.Client{
		Timeout:       5 * time.Second,
		Transport:     &http.Transport{Proxy: nil, DialContext: (&net.Dialer{Timeout: 5 * time.Second}).DialContext, TLSHandshakeTimeout: 5 * time.Second, MaxResponseHeaderBytes: 16 * 1024},
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	c.lookup = dohLookup(resolver, "https://1.1.1.1/dns-query")
	return c
}

func dohLookup(client *http.Client, endpoint string) func(context.Context, string) ([]net.IPAddr, error) {
	return func(ctx context.Context, host string) ([]net.IPAddr, error) {
		name, err := dnsmessage.NewName(host + ".")
		if err != nil {
			return nil, errors.New("invalid DNS name")
		}
		var addresses []net.IPAddr
		for _, kind := range []dnsmessage.Type{dnsmessage.TypeA, dnsmessage.TypeAAAA} {
			query := dnsmessage.Message{Header: dnsmessage.Header{RecursionDesired: true}, Questions: []dnsmessage.Question{{Name: name, Type: kind, Class: dnsmessage.ClassINET}}}
			wire, err := query.Pack()
			if err != nil {
				return nil, errors.New("invalid DNS query")
			}
			target := endpoint + "?dns=" + url.QueryEscape(base64.RawURLEncoding.EncodeToString(wire))
			req, err := http.NewRequestWithContext(ctx, http.MethodGet, target, nil)
			if err != nil {
				return nil, errors.New("invalid DNS endpoint")
			}
			req.Header.Set("Accept", "application/dns-message")
			response, err := client.Do(req)
			if err != nil {
				return nil, errors.New("DNS HTTPS request failed")
			}
			body, readErr := io.ReadAll(io.LimitReader(response.Body, 65537))
			_ = response.Body.Close()
			if response.StatusCode != http.StatusOK || readErr != nil || len(body) > 65536 {
				return nil, errors.New("invalid DNS HTTPS response")
			}
			var reply dnsmessage.Message
			if reply.Unpack(body) != nil || !reply.Response || reply.Truncated || reply.RCode != dnsmessage.RCodeSuccess || reply.ID != query.ID || len(reply.Questions) != 1 || reply.Questions[0] != query.Questions[0] {
				return nil, errors.New("invalid DNS answer")
			}
			for _, answer := range reply.Answers {
				if answer.Header.Class != dnsmessage.ClassINET {
					continue
				}
				switch value := answer.Body.(type) {
				case *dnsmessage.AResource:
					addresses = append(addresses, net.IPAddr{IP: net.IP(value.A[:])})
				case *dnsmessage.AAAAResource:
					addresses = append(addresses, net.IPAddr{IP: net.IP(value.AAAA[:])})
				}
			}
		}
		return addresses, nil
	}
}
