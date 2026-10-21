package extract

import (
	"math"
	"net/url"
	"sort"
	"strconv"
	"strings"

	"golang.org/x/net/html"
	"linkbook/linkprocessing"
)

// Candidate order is deterministic: lazy sources precede ordinary placeholders;
// srcsets prefer the largest declared variant. No viewport/browser is required.
func imageCandidates(n *html.Node, base *url.URL) []string {
	attrs := map[string]string{}
	for _, a := range n.Attr {
		attrs[a.Key] = a.Val
	}
	var out []string
	add := func(raw string) {
		raw = strings.TrimSpace(raw)
		if len(out) >= 8 || len(raw) > 65536 {
			return
		}
		ref, err := url.Parse(strings.TrimSpace(raw))
		if err != nil || raw == "" {
			return
		}
		resolved := ref
		if base != nil {
			resolved = base.ResolveReference(ref)
		}
		value := resolved.String()
		if !linkprocessing.SafeHref(value) || strings.ContainsAny(value, "\\ \r\n\t") {
			return
		}
		for _, v := range out {
			if v == value {
				return
			}
		}
		out = append(out, value)
	}
	for _, key := range []string{"data-srcset", "data-src", "data-original", "data-lazy-src", "srcset", "src"} {
		if strings.HasSuffix(key, "srcset") {
			type variant struct {
				raw  string
				size float64
			}
			var variants []variant
			// Bound parsing independently of the number of accepted candidates.
			remaining := attrs[key]
			for i := 0; i < 64 && remaining != ""; i++ {
				var fields []string
				fields, remaining = nextSrcsetCandidate(remaining)
				if len(fields) < 1 || len(fields) > 2 {
					continue
				}
				size := float64(1)
				if len(fields) == 2 {
					d := fields[1]
					if len(d) < 2 || !strings.ContainsAny(d[len(d)-1:], "wx") {
						continue
					}
					var err error
					size, err = strconv.ParseFloat(d[:len(d)-1], 64)
					if err != nil || math.IsNaN(size) || size <= 0 || size > 100000 {
						continue
					}
					if d[len(d)-1] == 'w' && size != float64(int(size)) {
						continue
					}
				}
				variants = append(variants, variant{fields[0], size})
			}
			sort.SliceStable(variants, func(i, j int) bool { return variants[i].size > variants[j].size })
			for _, v := range variants {
				add(v.raw)
			}
		} else {
			add(attrs[key])
		}
	}
	return out
}

// Only the first base[href] has HTML semantics. It is not fetched or trusted:
// every resolved candidate still passes safehttp's DNS/pinning/redirect policy.
func documentBase(root *html.Node, final *url.URL) *url.URL {
	var found bool
	resolved := final
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if found {
			return
		}
		if n.Type == html.ElementNode && n.Data == "base" {
			for _, a := range n.Attr {
				if a.Key == "href" {
					found = true
					ref, err := url.Parse(strings.TrimSpace(a.Val))
					if err == nil {
						value := final.ResolveReference(ref)
						if linkprocessing.SafeHref(value.String()) {
							resolved = value
						}
					}
					return
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
	return resolved
}

// URLs in srcset end at ASCII whitespace, not at an embedded comma (notably
// query strings and data URLs). Only trailing URL commas or descriptor commas
// separate candidates. Never reinterpret a fragment of a data URL as relative.
func nextSrcsetCandidate(input string) ([]string, string) {
	const spaces = " \t\n\r\f"
	input = strings.TrimLeft(input, spaces+",")
	if input == "" {
		return nil, ""
	}
	end := strings.IndexAny(input, spaces)
	if end < 0 {
		return []string{strings.TrimRight(input, ",")}, ""
	}
	raw, rest := input[:end], input[end:]
	if strings.HasSuffix(raw, ",") {
		return []string{strings.TrimRight(raw, ",")}, rest
	}
	descriptors, remaining, found := strings.Cut(rest, ",")
	fields := append([]string{raw}, strings.Fields(descriptors)...)
	if !found {
		remaining = ""
	}
	return fields, remaining
}
