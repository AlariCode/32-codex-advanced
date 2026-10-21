package extract

import (
	"golang.org/x/net/html"
	"strings"
)

// Inspect the original DOM before sanitization removes access gates. Never
// fetch hidden APIs, execute scripts or extract behind an explicit paywall.
func availability(root *html.Node) (metadata string, blocked, article bool, prose int) {
	articles, teasers, video := 0, 0, false
	declaredVideo := false
	content := availabilityContent(root)
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.ElementNode {
			attr := func(key string) string {
				for _, a := range n.Attr {
					if a.Key == key {
						return strings.TrimSpace(a.Val)
					}
				}
				return ""
			}
			if n.Data == "title" && metadata == "" {
				metadata = text(n)
			}
			if n.Data == "meta" {
				property := attr("property")
				if property == "" {
					property = attr("name")
				}
				if strings.EqualFold(property, "og:type") {
					kind := strings.ToLower(attr("content"))
					declaredVideo = declaredVideo || kind == "video" || strings.HasPrefix(kind, "video.")
				}
				if metadata == "" && (property == "og:title" || property == "twitter:title") {
					metadata = attr("content")
				}
				if strings.EqualFold(attr("itemprop"), "isAccessibleForFree") && strings.EqualFold(attr("content"), "false") {
					blocked = true
				}
			}
			if n.Data == "form" && mandatoryReadingGate(n) {
				blocked = true
			}
			if n.Data == "input" && strings.EqualFold(attr("type"), "password") && contentGate(n, content) {
				blocked = true
			}
			if n.Data == "article" || strings.EqualFold(attr("itemtype"), "https://schema.org/Article") {
				article = true
				nested := false
				for parent := n.Parent; parent != nil; parent = parent.Parent {
					if parent.Type == html.ElementNode && parent.Data == "article" {
						nested = true
						break
					}
				}
				if !nested {
					articles++
					if heading := articleHeadline(n); heading != nil && linkedHeading(heading, false) {
						teasers++
					}
				}
			}
			if n.Data == "video" {
				video = true
			}
			if n.Data == "p" {
				prose += len(text(n))
			}
			// JSON-LD is a public access declaration, not article content.
			if n.Data == "script" && attr("type") == "application/ld+json" {
				compact := strings.NewReplacer(" ", "", "\n", "", "\t", "", "\r", "").Replace(codeRaw(n))
				if strings.Contains(compact, `"isAccessibleForFree":false`) || strings.Contains(compact, `"isAccessibleForFree":"false"`) {
					blocked = true
				}
			}
			if active(n.Data) && n.Data != "form" {
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			visit(c)
		}
	}
	visit(root)
	blocked = blocked || (articles > 1 && teasers == articles) || (video && !article && !writtenNarrative(content)) || declaredVideo
	return
}
func codeRaw(n *html.Node) string {
	var b strings.Builder
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if c.Type == html.TextNode {
			b.WriteString(c.Data)
		}
	}
	return b.String()
}

// A headline precedes substantive prose. Links in later section headings or
// nested recommendations do not make a full article a teaser, including when
// the article begins directly with its body instead of a heading.
func articleHeadline(root *html.Node) *html.Node {
	var heading *html.Node
	var find func(*html.Node) bool
	find = func(n *html.Node) bool {
		if n.Type == html.ElementNode {
			if active(n.Data) || (n != root && n.Data == "article") {
				return false
			}
			switch n.Data {
			case "h1", "h2", "h3":
				heading = n
				return true
			case "p":
				if len(text(n)) >= 200 {
					return true
				}
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			if find(c) {
				return true
			}
		}
		return false
	}
	find(root)
	return heading
}

// A collection needs both multiple article containers and linked headlines;
// a multi-part article by itself is not evidence of a homepage.
func linkedHeading(n *html.Node, heading bool) bool {
	if n.Type == html.ElementNode {
		heading = heading || n.Data == "h1" || n.Data == "h2" || n.Data == "h3"
		if heading && n.Data == "a" {
			return true
		}
	}
	for c := n.FirstChild; c != nil; c = c.NextSibling {
		if linkedHeading(c, heading) {
			return true
		}
	}
	return false
}

// Prefer a declared article/main containing real prose. For unmarked pages,
// scope access controls to the container of the strongest paragraph, rather
// than treating a sibling account form as a restriction on the whole page.
func availabilityContent(root *html.Node) *html.Node {
	var paragraph *html.Node
	longest := 0
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.ElementNode && active(n.Data) {
			return
		}
		if n.Type == html.ElementNode && n.Data == "p" {
			if size := len(text(n)); size > longest {
				longest = size
				paragraph = n
			}
			return
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			visit(c)
		}
	}
	visit(root)
	if paragraph == nil {
		return root
	}
	for n := paragraph.Parent; n != nil; n = n.Parent {
		if n.Type == html.ElementNode && (n.Data == "article" || n.Data == "main") {
			return n
		}
	}
	return paragraph.Parent
}

func contentGate(n, content *html.Node) bool {
	for ; n != nil; n = n.Parent {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "header", "nav", "aside", "footer":
				return false
			}
		}
		if n == content {
			return true
		}
	}
	return false
}

// Video is supplementary when the selected region has a written heading and
// substantive prose. A bare player/description does not provide that evidence.
func writtenNarrative(root *html.Node) bool {
	heading, prose := false, 0
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.ElementNode {
			if active(n.Data) {
				return
			}
			switch n.Data {
			case "h1", "h2":
				heading = heading || text(n) != ""
			case "p":
				prose += len(text(n))
				return
			}
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			visit(c)
		}
	}
	visit(root)
	return heading && prose >= 200
}

// A form explicitly requiring authentication to read is a gate even when it
// is a sibling of the preview. A generic account/login form is not evidence.
// Inspect form instructions and its immediate wrapper, never article prose.
func mandatoryReadingGate(form *html.Node) bool {
	var instructions strings.Builder
	label := func(n *html.Node) {
		for _, a := range n.Attr {
			if a.Key == "aria-label" || a.Key == "title" {
				instructions.WriteString(a.Val)
				instructions.WriteByte(' ')
			}
		}
	}
	var visit func(*html.Node)
	visit = func(n *html.Node) {
		if n.Type == html.ElementNode {
			switch n.Data {
			case "script", "style", "template", "article", "main":
				return
			}
			label(n)
		}
		if n.Type == html.TextNode {
			instructions.WriteString(n.Data)
			instructions.WriteByte(' ')
		}
		for c := n.FirstChild; c != nil; c = c.NextSibling {
			visit(c)
		}
	}
	visit(form)
	if parent := form.Parent; parent != nil {
		label(parent)
		for c := parent.FirstChild; c != nil; c = c.NextSibling {
			if c.Type == html.TextNode {
				visit(c)
				continue
			}
			if c.Type != html.ElementNode {
				continue
			}
			switch c.Data {
			case "h1", "h2", "h3", "p", "label", "legend":
				visit(c)
			}
		}
	}
	value := strings.ToLower(strings.Join(strings.Fields(instructions.String()), " "))
	for _, phrase := range []string{
		"sign in to read", "sign in to continue", "log in to read", "log in to continue", "login to read", "login to continue",
		"войдите, чтобы прочитать", "войдите, чтобы читать", "войдите, чтобы продолжить", "войдите для чтения",
	} {
		if strings.Contains(value, phrase) {
			return true
		}
	}
	return false
}
