// Package safehttp fetches bounded HTML through a fresh IP-pinned transport.
package safehttp

import (
	"context"
	"crypto/tls"
	"errors"
	"io"
	"mime"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
	"time"

	"linkbook/linkprocessing"
)

type Page struct {
	HTML     []byte
	FinalURL string
}
type failure string

func (e failure) Error() string { return string(e) }
func Code(err error) string {
	var transient transientFailure
	if errors.As(err, &transient) {
		return transient.code
	}
	var f failure
	if errors.As(err, &f) {
		return string(f)
	}
	if err == nil {
		return ""
	}
	return "network_error"
}

type Client struct {
	lookup        func(context.Context, string) ([]net.IPAddr, error)
	dial          func(context.Context, string, string) (net.Conn, error)
	fixtureOrigin string
}

func New() *Client {
	return &Client{
		lookup: func(ctx context.Context, host string) ([]net.IPAddr, error) {
			ips, err := net.DefaultResolver.LookupNetIP(ctx, "ip", host)
			out := make([]net.IPAddr, 0, len(ips))
			for _, ip := range ips {
				out = append(out, net.IPAddr{IP: net.IP(ip.AsSlice())})
			}
			return out, err
		},
		dial: (&net.Dialer{Timeout: 5 * time.Second, KeepAlive: -1}).DialContext,
	}
}

// ForFixture is used only by the separately built integration harness, never
// selected by worker environment/configuration. The exception is one exact
// loopback origin; all redirects and other destinations retain production policy.
func ForFixture(origin string) (*Client, error) {
	u, err := url.Parse(origin)
	if err != nil || u.Scheme != "http" || u.User != nil || u.Path != "" || u.RawQuery != "" || u.Fragment != "" {
		return nil, failure("destination_blocked")
	}
	ip, err := netip.ParseAddr(u.Hostname())
	if err != nil || !ip.IsLoopback() || u.Port() == "" {
		return nil, failure("destination_blocked")
	}
	c := New()
	c.fixtureOrigin = u.Scheme + "://" + u.Host
	return c, nil
}

var forbidden = func() []netip.Prefix {
	ranges := []string{"0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4", "2001::/23", "2001:db8::/32", "2002::/16", "3fff::/20"}
	out := make([]netip.Prefix, 0, len(ranges))
	for _, s := range ranges {
		out = append(out, netip.MustParsePrefix(s))
	}
	return out
}()

func public(ip netip.Addr) bool {
	if !ip.IsValid() || ip.Is4In6() || !ip.IsGlobalUnicast() || ip.IsPrivate() || ip.Zone() != "" {
		return false
	}
	if ip.Is6() && !netip.MustParsePrefix("2000::/3").Contains(ip) {
		return false
	}
	for _, p := range forbidden {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}
func (c *Client) destination(ctx context.Context, u *url.URL) (string, error) {
	if (u.Scheme != "http" && u.Scheme != "https") || u.User != nil || u.Opaque != "" || u.Hostname() == "" || strings.ContainsAny(u.Host, "\\%\r\n\t ") {
		return "", failure("destination_blocked")
	}
	port := u.Port()
	if port == "" {
		port = "80"
		if u.Scheme == "https" {
			port = "443"
		}
	}
	host := u.Hostname()
	if c.fixtureOrigin != "" && u.Scheme+"://"+u.Host == c.fixtureOrigin {
		return net.JoinHostPort(host, port), nil
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		if !public(ip) {
			return "", failure("destination_blocked")
		}
		return net.JoinHostPort(ip.String(), port), nil
	}
	// Reject ambiguous numeric host forms instead of delegating interpretation.
	if !strings.Contains(host, ".") || strings.HasPrefix(strings.ToLower(host), "0x") {
		return "", failure("destination_blocked")
	}
	answers, err := c.lookup(ctx, host)
	if err != nil {
		return "", transientFailure{code: "network_error"}
	}
	if len(answers) == 0 {
		return "", transientFailure{code: "network_error"}
	}
	for _, answer := range answers {
		ip, ok := netip.AddrFromSlice(answer.IP)
		if !ok || answer.Zone != "" || !public(ip) {
			return "", failure("destination_blocked")
		}
	}
	ip, _ := netip.AddrFromSlice(answers[0].IP)
	return net.JoinHostPort(ip.String(), port), nil
}

type transientFailure struct {
	code    string
	retryAt time.Time
}

func (e transientFailure) Error() string { return e.code }

// Fetch retries at most four times within the caller's original attempt budget.
// Each retry repeats URL/DNS/redirect checks through a fresh pinned transport.
func (c *Client) Fetch(ctx context.Context, raw string) (Page, error) {
	var page Page
	var err error
	for attempt := 0; attempt < 5; attempt++ {
		page, err = c.fetchOnce(ctx, raw, false)
		if err == nil {
			return page, nil
		}
		var transient transientFailure
		if !errors.As(err, &transient) || attempt == 4 || ctx.Err() != nil {
			return Page{}, err
		}
		delay := time.Duration(1<<attempt) * 250 * time.Millisecond
		if remaining := time.Until(transient.retryAt); remaining > delay {
			delay = remaining
		}
		timer := time.NewTimer(delay)
		select {
		case <-ctx.Done():
			timer.Stop()
			return Page{}, err
		case <-timer.C:
		}
	}
	return page, err
}
func retryAt(value string) time.Time {
	if seconds, err := strconv.ParseInt(value, 10, 64); err == nil && seconds >= 0 {
		// Saturate hostile/overflowing values; never wrap into an immediate retry.
		if seconds > 86400 {
			seconds = 86400
		}
		return time.Now().Add(time.Duration(seconds) * time.Second)
	}
	date, _ := http.ParseTime(value)
	return date
}
func (c *Client) fetchOnce(parent context.Context, raw string, image bool) (Page, error) {
	ctx, cancel := context.WithTimeout(parent, 25*time.Second)
	defer cancel()
	if len(raw) > 65536 || strings.ContainsAny(raw, "\\\r\n\t ") {
		return Page{}, failure("destination_blocked")
	}
	current, err := url.Parse(raw)
	if err != nil {
		return Page{}, failure("destination_blocked")
	}
	for redirects := 0; redirects <= 5; redirects++ {
		address, err := c.destination(ctx, current)
		if err != nil {
			return Page{}, err
		}
		transport := &http.Transport{
			Proxy: nil, DisableKeepAlives: true, MaxConnsPerHost: 1, MaxResponseHeaderBytes: 64 * 1024,
			TLSHandshakeTimeout: 5 * time.Second, ResponseHeaderTimeout: 8 * time.Second,
			DialContext: func(ctx context.Context, network, _ string) (net.Conn, error) { return c.dial(ctx, network, address) },
		}
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, current.String(), nil)
		if err != nil {
			return Page{}, failure("destination_blocked")
		}
		request.Header.Set("User-Agent", "Linkbook/1.0")
		request.Header.Set("Accept", "text/html, application/xhtml+xml")
		if image {
			request.Header.Set("Accept", "image/png, image/jpeg, image/gif")
		}
		response, err := transport.RoundTrip(request)
		if err != nil {
			transport.CloseIdleConnections()
			var certificate *tls.CertificateVerificationError
			if errors.As(err, &certificate) {
				return Page{}, failure("network_error")
			}
			return Page{}, transientFailure{code: "network_error"}
		}
		if response.StatusCode >= 300 && response.StatusCode < 400 {
			location := response.Header.Get("Location")
			_ = response.Body.Close()
			transport.CloseIdleConnections()
			if redirects == 5 {
				return Page{}, failure("redirect_limit")
			}
			next, err := url.Parse(location)
			if err != nil || location == "" {
				return Page{}, transientFailure{code: "network_error"}
			}
			current = current.ResolveReference(next)
			continue
		}
		if response.StatusCode < 200 || response.StatusCode >= 300 {
			_ = response.Body.Close()
			transport.CloseIdleConnections()
			if response.StatusCode == 429 || response.StatusCode >= 500 {
				return Page{}, transientFailure{code: "http_error", retryAt: retryAt(response.Header.Get("Retry-After"))}
			}
			return Page{}, failure("http_error")
		}

		// Go transparently decodes negotiated gzip. Never treat an unsupported
		// encoding (e.g. unsolicited br/deflate) as a complete HTML document.
		if encoding := response.Header.Get("Content-Encoding"); encoding != "" && encoding != "identity" {
			_ = response.Body.Close()
			transport.CloseIdleConnections()
			return Page{}, failure("unsupported_content")
		}
		media, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
		if !image && (err != nil || (media != "text/html" && media != "application/xhtml+xml")) {
			_ = response.Body.Close()
			transport.CloseIdleConnections()
			return Page{}, failure("unsupported_content")
		}
		limit := linkprocessing.MaxHTMLBytes
		if image {
			limit = linkprocessing.MaxImageBytes
		}
		body, err := io.ReadAll(io.LimitReader(response.Body, int64(limit+1)))
		_ = response.Body.Close()
		transport.CloseIdleConnections()
		if err != nil {
			return Page{}, transientFailure{code: "network_error"}
		}
		if len(body) > limit {
			if image {
				return Page{}, failure("image_too_large")
			}
			return Page{}, failure("html_too_large")
		}
		return Page{HTML: body, FinalURL: current.String()}, nil
	}
	return Page{}, failure("redirect_limit")
}

// FetchImage uses exactly the HTML destination, DNS, pinned dial and redirect policy.
func (c *Client) FetchImage(ctx context.Context, raw string) ([]byte, error) {
	page, err := c.fetchOnce(ctx, raw, true)
	return page.HTML, err
}
