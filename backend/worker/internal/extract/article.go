package extract

import (
	"bytes"
	"errors"
	"io"
	"net/url"
	"strconv"
	"strings"

	readability "codeberg.org/readeck/go-readability/v2"
	"golang.org/x/net/html"
	"linkbook/linkprocessing"
)

var ErrResources = errors.New("parsing resource limit")

func Article(body []byte, finalURL string) (linkprocessing.Result, error) {
	result := linkprocessing.Result{FinalURL: finalURL, Warnings: []string{}}
	if len(body) > linkprocessing.MaxHTMLBytes {
		return result, ErrResources
	}
	// Preflight before DOM allocation/Readeck: cap tokens, nesting and input.
	tokens := 0
	stack := []string{}
	z := html.NewTokenizer(bytes.NewReader(body))
	for {
		kind := z.Next()
		if kind == html.ErrorToken {
			if z.Err() != io.EOF {
				return result, z.Err()
			}
			break
		}
		tokens++
		if tokens > 50000 {
			return result, ErrResources
		}
		if kind == html.StartTagToken || kind == html.SelfClosingTagToken {
			tag, _ := z.TagName()
			// In HTML, <div/> still opens a div. Only void elements can be
			// ignored; treating every slash as a close bypasses the budget.
			if !voidTag(string(tag)) {
				stack = append(stack, string(tag))
				if len(stack) > 128 {
					return result, ErrResources
				}
			}
		} else if kind == html.EndTagToken {
			tag, _ := z.TagName()
			for i := len(stack) - 1; i >= 0; i-- {
				if stack[i] == string(tag) {
					stack = stack[:i]
					break
				}
			}
		}
	}
	root, err := html.Parse(bytes.NewReader(body))
	if err != nil {
		return result, err
	}
	// Bound the actual parser tree too: malformed HTML can reparent nodes.
	nodes := 0
	var inspect func(*html.Node, int) bool
	inspect = func(n *html.Node, d int) bool {
		nodes++
		if nodes > 50000 || d > 128 {
			return false
		}
		for child := n.FirstChild; child != nil; child = child.NextSibling {
			if !inspect(child, d+1) {
				return false
			}
		}
		return true
	}
	if !inspect(root, 0) {
		return result, ErrResources
	}
	u, err := url.Parse(finalURL)
	if err != nil {
		return result, err
	}
	metadata := ""
	omitted := false
	var clean func(*html.Node)
	clean = func(n *html.Node) {
		for child := n.FirstChild; child != nil; {
			next := child.NextSibling
			if child.Type == html.ElementNode {
				switch child.Data {
				case "title":
					metadata = text(child)
				case "img", "picture", "video", "audio", "table":
					omitted = true
				}
				if active(child.Data) {
					n.RemoveChild(child)
				} else {
					clean(child)
				}
			}
			child = next
		}
	}
	clean(root)
	parser := readability.NewParser()
	parser.MaxElemsToParse = 50000
	parser.KeepClasses = true // Read language markers; classes never enter the document.
	article, err := parser.ParseDocument(root, u)
	if err != nil {
		return result, err
	}
	result.Title = strings.TrimSpace(article.Title())
	if result.Title == "" {
		result.Title = metadata
	}
	if result.Title == "" {
		result.Title = u.Hostname()
	}
	doc := linkprocessing.Document{SchemaVersion: 1, Blocks: []linkprocessing.Block{}}
	var convert func(*html.Node)
	convert = func(n *html.Node) {
		if n.Type == html.ElementNode {
			var b linkprocessing.Block
			switch n.Data {
			case "p":
				b = linkprocessing.Block{Kind: "paragraph", Text: text(n)}
			case "h1", "h2", "h3", "h4", "h5", "h6":
				level, _ := strconv.Atoi(n.Data[1:])
				if level < 2 {
					level = 2
				}
				b = linkprocessing.Block{Kind: "heading", Level: level, Text: text(n)}
			case "blockquote":
				b = linkprocessing.Block{Kind: "quote", Text: text(n)}
			case "ul", "ol":
				b = linkprocessing.Block{Kind: "list", Ordered: n.Data == "ol"}
				for c := n.FirstChild; c != nil; c = c.NextSibling {
					if c.Type == html.ElementNode && c.Data == "li" {
						if s := text(c); s != "" {
							b.Items = append(b.Items, s)
						}
					}
				}
			case "pre":
				b = linkprocessing.Block{Kind: "code", Text: codeText(n), Language: codeLanguage(n)}
			}
			if b.Text != "" || len(b.Items) > 0 {
				doc.Blocks = append(doc.Blocks, b)
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			convert(c)
		}
	}
	if article.Node != nil {
		convert(article.Node)
	}
	if err = linkprocessing.ValidateDocument(doc); err != nil {
		return result, err
	}
	if omitted {
		result.Warnings = append(result.Warnings, "text_only_archive")
	}
	result.Document = &doc
	return result, nil
}
func voidTag(tag string) bool {
	switch tag {
	case "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr":
		return true
	}
	return false
}
func active(tag string) bool {
	switch tag {
	case "script", "style", "iframe", "svg", "math", "form", "input", "button", "object", "embed", "template", "noscript", "nav", "footer":
		return true
	}
	return false
}
func text(n *html.Node) string {
	var out strings.Builder
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.ElementNode && active(n.Data) {
			return
		}
		if n.Type == html.TextNode {
			out.WriteString(n.Data)
			out.WriteByte(' ')
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			visit(c)
		}
	}
	visit(n)
	return strings.Join(strings.Fields(out.String()), " ")
}

func codeText(n *html.Node) string {
	var out strings.Builder
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.TextNode {
			out.WriteString(n.Data)
			return
		}
		if n.Type == html.ElementNode {
			if active(n.Data) {
				return
			}
			if n.Data == "br" {
				out.WriteByte('\n')
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			visit(c)
		}
	}
	visit(n)
	return out.String()
}
func codeLanguage(n *html.Node) string {
	for _, a := range n.Attr {
		if a.Key != "class" && a.Key != "data-language" {
			continue
		}
		for _, value := range strings.Fields(a.Val) {
			if a.Key == "class" {
				if strings.HasPrefix(value, "language-") {
					value = strings.TrimPrefix(value, "language-")
				} else if strings.HasPrefix(value, "lang-") {
					value = strings.TrimPrefix(value, "lang-")
				} else {
					continue
				}
			}
			value = strings.ToLower(value)
			if len(value) == 0 || len(value) > 40 {
				continue
			}
			valid := true
			for _, c := range value {
				if !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || strings.ContainsRune("_+#.-", c)) {
					valid = false
				}
			}
			if valid {
				return value
			}
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if language := codeLanguage(c); language != "" {
			return language
		}
	}
	return ""
}
