package extract

import (
	"strings"
	"testing"

	"linkbook/linkprocessing"
)

func TestInlineCodeTextComparisonWarnsOnlyForActualLoss(t *testing.T) {
	for _, code := range []struct{ name, html, want string }{
		{"nested spans", "<code>archive<span>.</span>read<span>(</span>entry<span>)</span></code>", "archive.read(entry)"},
		{"nested emphasis and entities", "<code><b>a</b>&lt;<span>b</span>&amp;&amp;<i>c</i></code>", "a<b&&c"},
		{"whitespace and line break", "<code>  first<span>  second</span><br>\tthird  </code>", "  first  second\n\tthird  "},
	} {
		for _, missing := range []bool{false, true} {
			t.Run(code.name+map[bool]string{false: "/complete", true: "/missing paragraph"}[missing], func(t *testing.T) {
				body := "<article><h1>Inline source code</h1><p>" + strings.Repeat("This original article explains durable preservation of source code and surrounding prose. ", 12) + "Use " + code.html + " to read the saved entry.</p>"
				if missing {
					body += `<p class="comment">LOST MAIN PARAGRAPH ` + strings.Repeat("These original words belong to a separate paragraph in the main article. ", 5) + "</p>"
				}
				body += "</article>"
				r, err := Article([]byte(body), "https://example.com/code")
				if err != nil {
					t.Fatal(err)
				}
				if r.Document == nil {
					t.Fatal("missing usable article")
				}
				var actualCode string
				var walk func([]linkprocessing.Block)
				walk = func(bs []linkprocessing.Block) {
					for _, b := range bs {
						if b.Kind == "inline_code" {
							if len(b.Children) != 1 {
								t.Fatal("unexpected inline code", b)
							}
							actualCode = b.Children[0].Text
						}
						walk(b.Children)
					}
				}
				walk(r.Document.Blocks)
				if actualCode != code.want {
					t.Fatalf("inline code changed: %q want %q", actualCode, code.want)
				}
				if strings.Contains(documentText(r.Document.Blocks), "LOST MAIN PARAGRAPH") {
					t.Fatal("fixture must exercise actual text loss")
				}
				warned := false
				for _, w := range r.Warnings {
					if w == "text_incomplete" {
						warned = true
					}
				}
				if warned != missing {
					t.Fatalf("text_incomplete=%v want %v; warnings=%v", warned, missing, r.Warnings)
				}
			})
		}
	}
}
