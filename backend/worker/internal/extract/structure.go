package extract

import (
	"golang.org/x/net/html"
	"linkbook/linkprocessing"
	"net/url"
	"strconv"
	"strings"
)

func structured(root *html.Node, base *url.URL, protected map[string]*html.Node, restored map[string]bool) []linkprocessing.Block {
	var walk func(*html.Node) []linkprocessing.Block
	walk = func(n *html.Node) []linkprocessing.Block {
		if n.Type == html.TextNode {
			// Collapse HTML whitespace without introducing spaces around inline tags.
			value := strings.Map(func(r rune) rune {
				if r == '\n' || r == '\r' || r == '\t' || r == '\f' {
					return ' '
				}
				return r
			}, n.Data)
			for strings.Contains(value, "  ") {
				value = strings.ReplaceAll(value, "  ", " ")
			}
			if value == "" {
				return nil
			}
			return []linkprocessing.Block{{Kind: "text", Text: value}}
		}
		if n.Type == html.ElementNode && active(n.Data) {
			return nil
		}
		if n.Type == html.ElementNode && n.Data == "p" {
			marker, _, _ := strings.Cut(codeText(n), " ")
			if original, ok := protected[marker]; ok {
				if restored[marker] {
					return nil
				}
				restored[marker] = true
				return walk(original)
			}
		}
		if n.Data == "pre" {
			if strings.TrimSpace(codeText(n)) == "" {
				return nil
			}
			return []linkprocessing.Block{{Kind: "code", Text: codeText(n), Language: codeLanguage(n)}}
		}
		b := linkprocessing.Block{}
		switch n.Data {
		case "p":
			b.Kind = "paragraph"
		case "h1", "h2", "h3", "h4", "h5", "h6":
			b.Kind = "heading"
			b.Level, _ = strconv.Atoi(n.Data[1:])
		case "blockquote":
			b.Kind = "quote"
		case "ol", "ul":
			b.Kind = "list"
			b.Ordered = n.Data == "ol"
		case "li":
			b.Kind = "list_item"
		case "strong", "b":
			b.Kind = "strong"
		case "em", "i":
			b.Kind = "em"
		case "code":
			value := codeText(n)
			if value == "" {
				return nil
			}
			return []linkprocessing.Block{{Kind: "inline_code", Children: []linkprocessing.Block{{Kind: "text", Text: value}}}}
		case "br":
			return []linkprocessing.Block{{Kind: "br"}}
		case "table", "caption", "details", "summary":
			b.Kind = n.Data
		case "thead":
			b.Kind = "table_head"
		case "tbody":
			b.Kind = "table_body"
		case "tfoot":
			b.Kind = "table_foot"
		case "tr":
			b.Kind = "table_row"
		case "td":
			b.Kind = "cell"
		case "th":
			b.Kind = "header_cell"
		case "a":
			for _, a := range n.Attr {
				if a.Key == "href" {
					ref, err := url.Parse(strings.TrimSpace(a.Val))
					if err == nil {
						value := base.ResolveReference(ref).String()
						if linkprocessing.SafeHref(value) {
							b.Kind = "link"
							b.Href = value
						}
					}
				}
			}
		}
		var children []linkprocessing.Block
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			children = append(children, walk(c)...)
		}
		if b.Kind == "" {
			return children
		}
		// Structural whitespace must not become table/list children.
		if b.Kind == "list" || strings.HasPrefix(b.Kind, "table") {
			kept := children[:0]
			for _, c := range children {
				if c.Kind != "text" || strings.TrimSpace(c.Text) != "" {
					kept = append(kept, c)
				}
			}
			children = kept
		}
		if b.Kind == "details" && (len(children) == 0 || children[0].Kind != "summary") {
			// Whitespace before summary is immaterial; native details needs summary first.
			for len(children) > 0 && children[0].Kind == "text" && strings.TrimSpace(children[0].Text) == "" {
				children = children[1:]
			}
			if len(children) == 0 || children[0].Kind != "summary" {
				children = append([]linkprocessing.Block{{Kind: "summary", Children: []linkprocessing.Block{{Kind: "text", Text: "Подробнее"}}}}, children...)
			}
		}
		if len(children) == 0 {
			return nil
		}
		b.Children = children
		return []linkprocessing.Block{b}
	}
	nodes := walk(root)
	// Insignificant formatting whitespace outside blocks is not article content.
	kept := nodes[:0]
	for _, n := range nodes {
		if n.Kind != "text" || strings.TrimSpace(n.Text) != "" {
			kept = append(kept, n)
		}
	}
	return kept
}
