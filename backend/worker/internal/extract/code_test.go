package extract

import (
	"strings"
	"testing"
)

func TestArticlePreservesCodeWhitespaceAndLanguage(t *testing.T) {
	code := "* {\n  margin: 0;\n  padding: 0;\n}\n"
	input := `<article><h1>Understanding universal selectors</h1><p>` + strings.Repeat("An article about CSS explains selectors with meaningful practical examples and their behavior. ", 20) + `</p><pre><code class="language-css"><span>*</span> {
  margin: 0;
  padding: 0;
}
</code></pre><p>The selector applies to every element.</p></article>`
	result, err := Article([]byte(input), "https://example.com/article")
	if err != nil {
		t.Fatal(err)
	}
	for _, b := range result.Document.Blocks {
		if b.Kind == "code" {
			if b.Language != "css" {
				t.Fatalf("code language lost: %q", b.Language)
			}
			if b.Text != code {
				t.Fatalf("code whitespace changed: %q", b.Text)
			}
			return
		}
	}
	t.Fatal("code was flattened into a paragraph")
}
