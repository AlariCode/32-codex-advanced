package extract

import (
	"encoding/json"
	"linkbook/linkprocessing"
	"os"
	"strings"
	"testing"
)

func TestFormattingFixture(t *testing.T) {
	body, err := os.ReadFile("../../../../web/tests/fixtures/formatting.html")
	if err != nil {
		t.Fatal(err)
	}
	r, err := Article(body, "https://example.com/guides/article")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(r.Document)
	s := string(raw)
	for _, want := range []string{`"schema_version":2`, `"kind":"strong"`, `"kind":"em"`, `"kind":"inline_code"`, `"kind":"table"`, `"kind":"details"`, `"kind":"summary"`, `"href":"https://example.com/reference"`, `"level":1`, `"language":"css"`} {
		if !strings.Contains(s, want) {
			t.Errorf("missing %s in %s", want, s)
		}
	}
	for _, bad := range []string{"SECRET", "javascript:", "data:", "onclick", "style", "iframe", "svg", "math"} {
		if strings.Contains(s, bad) {
			t.Errorf("unsafe content %s", bad)
		}
	}
	for _, once := range []string{"Nested child marker", "After nested marker", "Cell marker", "Disclosure marker"} {
		if strings.Count(s, once) != 1 {
			t.Errorf("lost or duplicated %s: %s", once, s)
		}
	}
	if !strings.Contains(s, `  margin: 0;\n`) {
		t.Fatal("code whitespace lost")
	}
	if _, err := linkprocessing.DecodeDocument(raw); err != nil {
		t.Fatal(err)
	}
}

func TestNestedCodeRemainsVerbatim(t *testing.T) {
	code := "  x  = 1;\n\treturn x;\n"
	body := `<article><h1>Nested examples</h1><p>` + strings.Repeat("Practical code examples explain preserving meaningful source formatting in a durable archive. ", 20) + `</p><ul><li><p>Before nested code</p><pre><code class="language-javascript">` + code + `</code></pre><p>After nested code</p></li></ul><p>Inline <code>a  b
 c</code> stays literal.</p></article>`
	r, err := Article([]byte(body), "https://example.com/a")
	if err != nil {
		t.Fatal(err)
	}
	var foundCode, foundInline bool
	var visit func(linkprocessing.Block)
	visit = func(b linkprocessing.Block) {
		if b.Kind == "code" {
			foundCode = true
			if b.Text != code || b.Language != "javascript" {
				t.Errorf("nested code changed: %+v", b)
			}
		}
		if b.Kind == "inline_code" {
			foundInline = true
			if len(b.Children) != 1 || b.Children[0].Text != "a  b\n c" {
				t.Errorf("inline code changed: %+v", b)
			}
		}
		for _, c := range b.Children {
			visit(c)
		}
	}
	for _, b := range r.Document.Blocks {
		visit(b)
	}
	if !foundCode || !foundInline {
		t.Fatal("code lost")
	}
}
