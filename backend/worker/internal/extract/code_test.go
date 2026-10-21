package extract

import (
	"strings"
	"testing"

	"linkbook/linkprocessing"
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

func TestArticlePreservesHighlightedCodeCommentsWithoutHiddenScaffolding(t *testing.T) {
	code := "func main() {\n\t// Explain the pipeline.\n\tfmt.Println(4) // expected result\n}\n"
	input := `<article><h1>Pipeline example</h1><p>` + strings.Repeat("A public tutorial explains channels and cancellation with complete runnable examples. ", 20) + `</p><div class="playground"><pre style="display: none">HIDDEN LICENSE AND PACKAGE SCAFFOLDING</pre><pre>func main() {
	<span class="comment">// Explain the pipeline.</span>
	fmt.Println(4) <span class="comment">// expected result</span>
}
</pre></div><div hidden><pre>HIDDEN WRAPPER SCAFFOLDING</pre></div><p>The complete conclusion.</p></article>`
	r, err := Article([]byte(input), "https://example.com/tutorial")
	if err != nil || r.Document == nil {
		t.Fatalf("article rejected: %+v %v", r, err)
	}
	var codes []linkprocessing.Block
	for _, b := range r.Document.Blocks {
		if b.Kind == "code" {
			codes = append(codes, b)
		}
	}
	if len(codes) != 1 || codes[0].Text != code || codes[0].Language != "" {
		t.Fatalf("code comments changed or hidden content archived: %+v", codes)
	}
}
