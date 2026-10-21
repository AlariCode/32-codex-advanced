package extract

import (
	"golang.org/x/net/html"
	"linkbook/linkprocessing"
	"strings"
)

func documentText(bs []linkprocessing.Block) string {
	var values []string
	var walk func([]linkprocessing.Block)
	walk = func(bs []linkprocessing.Block) {
		for _, b := range bs {
			if b.Kind == "text" || b.Kind == "code" {
				values = append(values, b.Text)
			}
			walk(b.Children)
		}
	}
	walk(bs)
	return strings.Join(strings.Fields(strings.Join(values, " ")), " ")
}

type evidence struct{ paragraphs []string }

// Match documentText's text fragments. structured archives code as one
// verbatim fragment, so inline markup inside code must not add separators.
func evidenceText(root *html.Node) string {
	var values []string
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode {
			if active(n.Data) {
				return
			}
			if n.Data == "code" || n.Data == "pre" {
				values = append(values, codeText(n))
				return
			}
		}
		if n.Type == html.TextNode {
			values = append(values, n.Data)
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
	return strings.Join(strings.Fields(strings.Join(values, " ")), " ")
}

func mainEvidence(root *html.Node) evidence {
	e := evidence{}
	var walk func(*html.Node, bool)
	walk = func(n *html.Node, main bool) {
		if n.Type == html.ElementNode && active(n.Data) {
			return
		}
		main = main || n.Data == "article" || n.Data == "main"
		if main {
			switch n.Data {
			case "dl", "video", "audio", "sup", "sub", "del", "s":
				if value := evidenceText(n); value != "" {
					e.paragraphs = append(e.paragraphs, value)
				}
				return
			}
		}
		if main && n.Data == "p" {
			value := evidenceText(n)
			if len(value) >= 80 {
				e.paragraphs = append(e.paragraphs, value)
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c, main)
		}
	}
	walk(root, false)
	return e
}
func (e evidence) lost(bs []linkprocessing.Block) bool {
	archived := documentText(bs)
	// Match successive fragments in source order, avoiding a full scan for
	// each paragraph and detecting a missing copy of a repeated paragraph.
	for _, p := range e.paragraphs {
		at := strings.Index(archived, p)
		if at < 0 {
			return true
		}
		archived = archived[at+len(p):]
	}
	return false
}
func selectedLoss(root *html.Node, protected map[string]*html.Node, restored map[string]bool) bool {
	lost := false
	var walk func(*html.Node)
	walk = func(n *html.Node) {
		if n.Type == html.ElementNode && active(n.Data) {
			return
		}
		if n.Type == html.ElementNode {
			switch n.Data {
			case "video", "audio", "hr", "dl", "sup", "sub", "del", "s":
				lost = true
			}
			for _, a := range n.Attr {
				if a.Key == "rowspan" || a.Key == "colspan" || a.Key == "start" {
					lost = true
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c)
		}
	}
	walk(root)
	for marker, n := range protected {
		if restored[marker] {
			walk(n)
		}
	}
	return lost
}

// Explicit article/main boundaries provide evidence of dropped content;
// images in menus, ads and other unselected regions do not imply article loss.
func declaredMainNodes(root *html.Node) map[*html.Node]bool {
	out := map[*html.Node]bool{}
	var walk func(*html.Node, bool)
	walk = func(n *html.Node, main bool) {
		if n.Type == html.ElementNode && active(n.Data) {
			return
		}
		main = main || n.Data == "article" || n.Data == "main"
		if main && n.Type == html.ElementNode {
			out[n] = true
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			walk(c, main)
		}
	}
	walk(root, false)
	return out
}
func containsMainImage(n *html.Node, images map[*html.Node]bool) bool {
	if n.Data == "img" && images[n] {
		return true
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if containsMainImage(c, images) {
			return true
		}
	}
	return false
}
