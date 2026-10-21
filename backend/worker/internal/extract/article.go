package extract

import (
	"bytes"
	"crypto/rand"
	"errors"
	"io"
	"net/url"
	"strings"

	readability "codeberg.org/readeck/go-readability/v2"
	"golang.org/x/net/html"
	"golang.org/x/net/html/atom"
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
	base := documentBase(root, u)
	evidence := mainEvidence(root)
	mainNodes := declaredMainNodes(root)
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
	// Readeck intentionally unwraps details and can discard short data tables.
	// Keep their position inside its selected article using text-bearing placeholders.
	// Only placeholders surviving selection are restored; unrelated page content is never appended.
	protected := map[string]*html.Node{}
	restored := map[string]bool{}
	var protect func(*html.Node)
	protect = func(n *html.Node) {
		for c := n.FirstChild; c != nil; {
			next := c.NextSibling
			if c.Type == html.ElementNode && (c.Data == "table" || c.Data == "details" || c.Data == "h1" || c.Data == "figure" || c.Data == "img") {
				marker := "LINKBOOKARCHIVE" + rand.Text() + "END"
				placeholder := &html.Node{Type: html.ElementNode, Data: "p", DataAtom: atom.P}
				if c.Data == "img" {
					// Inline markers must not introduce a paragraph inside a paragraph.
					// Readeck may unwrap spans or merge adjacent text nodes; structured
					// restores these image tokens within text, never their ancestors.
					marker = "LINKBOOKIMAGE" + rand.Text() + ":END"
					placeholder.Data, placeholder.DataAtom = "span", atom.Span
				}
				protected[marker] = c
				// Retain selection hints only inside Readeck; none become archive props.
				for _, a := range c.Attr {
					if a.Key == "class" || a.Key == "id" {
						placeholder.Attr = append(placeholder.Attr, a)
					}
				}
				value := marker + " " + text(c)
				if c.Data == "img" {
					value = marker
				}
				placeholder.AppendChild(&html.Node{Type: html.TextNode, Data: value})
				n.InsertBefore(placeholder, c)
				n.RemoveChild(c)
			} else {
				protect(c)
			}
			c = next
		}
	}
	protect(root)
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
	doc := linkprocessing.Document{SchemaVersion: linkprocessing.SchemaVersion}
	if article.Node != nil {
		doc.Blocks = structured(article.Node, base, protected, restored)
	}
	if article.Node == nil || strings.TrimSpace(documentText(doc.Blocks)) == "" {
		result.Reason = "article_unavailable"
		return result, nil
	}
	lostText, lostImages := evidence.lost(doc.Blocks), false
	for marker, n := range protected {
		if !restored[marker] && mainNodes[n] {
			lostText = lostText || text(n) != ""
			lostImages = lostImages || containsMainImage(n, mainNodes)
		}
	}
	if lostImages {
		result.Warnings = append(result.Warnings, "images_omitted")
	}
	omitted = selectedLoss(article.Node, protected, restored)
	if lostText {
		result.Warnings = append(result.Warnings, "text_incomplete")
	}
	if err = linkprocessing.ValidateDocument(doc); err != nil {
		return result, err
	}
	if omitted {
		result.Warnings = append(result.Warnings, "text_only_archive")
	}
	var images bool
	var inspectImages func([]linkprocessing.Block)
	inspectImages = func(bs []linkprocessing.Block) {
		for _, b := range bs {
			if b.Kind == "image" {
				images = true
			}
			inspectImages(b.Children)
		}
	}
	inspectImages(doc.Blocks)
	if images {
		result.Warnings = append(result.Warnings, "images_pending")
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
	case "script", "style", "iframe", "svg", "math", "form", "input", "button", "object", "embed", "template", "noscript", "nav", "footer", "aside":
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
