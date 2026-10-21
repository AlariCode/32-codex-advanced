package extract

import (
	"regexp"
	"strings"

	"golang.org/x/net/html"
)

// React's completed streaming boundaries contain ordinary server-rendered HTML
// in a hidden segment, followed by a static $RC(boundary, segment) instruction.
// Reconstruct only that DOM move, without evaluating any publisher JavaScript or
// reading hydration data. Unresolved segments and other hidden content stay hidden.
var streamCompletion = regexp.MustCompile(`(?:^|[;}])\s*\$RC\("([A-Za-z0-9_-]*B:[0-9a-f]+)","([A-Za-z0-9_-]*S:[0-9a-f]+)"\)\s*;?\s*$`)

func resolveStreamedHTML(root *html.Node) {
	ids := map[string]*html.Node{}
	var scripts []*html.Node
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.ElementNode {
			if id := streamAttr(n, "id"); id != "" {
				if _, exists := ids[id]; exists {
					ids[id] = nil // Ambiguous IDs must never select arbitrary content.
				} else {
					ids[id] = n
				}
			}
			if n.Data == "script" && streamAttr(n, "src") == "" && !hiddenForSelection(n) {
				typ := streamAttr(n, "type")
				if typ == "" || typ == "text/javascript" {
					scripts = append(scripts, n)
				}
			}
			switch n.Data {
			case "template", "noscript", "svg", "math":
				return // Inert examples are not streaming instructions.
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			visit(c)
		}
	}
	visit(root)
	for _, script := range scripts {
		match := streamCompletion.FindStringSubmatch(codeRaw(script))
		if match == nil || !streamDescendant(script, root) {
			continue
		}
		boundary, segment := ids[match[1]], ids[match[2]]
		if boundary == nil || segment == nil || boundary.Data != "template" || segment.Data != "div" ||
			!streamDescendant(boundary, root) || !streamDescendant(segment, root) || streamDescendant(boundary, segment) ||
			segment.Parent != script.Parent {
			continue
		}
		hidden := false
		for _, a := range segment.Attr {
			hidden = hidden || a.Key == "hidden"
		}
		start := boundary.PrevSibling
		if !hidden || start == nil || start.Type != html.CommentNode || start.Data != "$?" {
			continue
		}
		// Find the matching end before mutating anything. Nested pending or
		// completed boundaries must not terminate removal of the fallback early.
		var end *html.Node
		depth := 0
		for n := boundary.NextSibling; n != nil; n = n.NextSibling {
			if n.Type != html.CommentNode {
				continue
			}
			switch n.Data {
			case "$", "$?", "$!", "$~", "&":
				depth++
			case "/$", "/&":
				if depth == 0 {
					end = n
				} else {
					depth--
				}
			}
			if end != nil {
				break
			}
		}
		if end == nil {
			continue
		}
		valid := true
		for n := boundary; n != end; n = n.NextSibling {
			if streamDescendant(segment, n) || streamDescendant(script, n) {
				valid = false
				break
			}
		}
		if !valid {
			continue
		}
		parent := boundary.Parent
		for n := boundary; n != end; {
			next := n.NextSibling
			parent.RemoveChild(n)
			n = next
		}
		for segment.FirstChild != nil {
			child := segment.FirstChild
			segment.RemoveChild(child)
			parent.InsertBefore(child, end)
		}
		segment.Parent.RemoveChild(segment)
		start.Data = "$"
	}
}

func streamAttr(n *html.Node, key string) string {
	for _, a := range n.Attr {
		if a.Key == key {
			return strings.TrimSpace(a.Val)
		}
	}
	return ""
}

func streamDescendant(n, ancestor *html.Node) bool {
	for ; n != nil; n = n.Parent {
		if n == ancestor {
			return true
		}
	}
	return false
}
