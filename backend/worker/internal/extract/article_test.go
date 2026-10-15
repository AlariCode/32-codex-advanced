package extract

import (
	"encoding/json"
	"strings"
	"testing"

	"linkbook/linkprocessing"
)

func TestArticleUsesReadeckAndOnlyPublishesKnownTextBlocks(t *testing.T) {
	content := `<!doctype html><html><head><title>Field notes on a quiet library</title></head><body><nav>SECRET MENU</nav><article><h1>Field notes on a quiet library</h1><p>` + strings.Repeat("An original article describes how a shared library preserves knowledge for its readers. ", 12) + `</p><h2>Keeping the record</h2><p>Every saved paragraph can be read again tomorrow.</p><ul><li>Keep the text</li><li>Read it later</li></ul><blockquote>A small archive outlasts a broken link.</blockquote><p onclick="evil()">Safe <a href="javascript:evil()">words</a><script>SECRET SCRIPT</script><iframe src="http://127.0.0.1">SECRET FRAME</iframe><svg><text>SECRET SVG</text></svg></p></article><footer>SECRET FOOTER</footer></body></html>`
	result, err := Article([]byte(content), "https://example.com/article")
	if err != nil {
		t.Fatal(err)
	}
	if result.Title != "Field notes on a quiet library" || result.Document == nil {
		t.Fatalf("missing extraction: %+v", result)
	}
	if err = linkprocessing.ValidateDocument(*result.Document); err != nil {
		t.Fatal(err)
	}
	data, _ := json.Marshal(result.Document)
	raw := string(data)
	for _, bad := range []string{"SECRET", "javascript:", "onclick", "<iframe", "<script", "<svg"} {
		if strings.Contains(raw, bad) {
			t.Errorf("unsafe/nonarticle text %q", bad)
		}
	}
	kinds := map[string]bool{}
	for _, b := range result.Document.Blocks {
		kinds[b.Kind] = true
	}
	for _, kind := range []string{"paragraph", "heading", "list", "quote"} {
		if !kinds[kind] {
			t.Errorf("missing %s in %s", kind, raw)
		}
	}
}
func TestArticleParsingResourceLimitsAndNoFalseCompleteTruncation(t *testing.T) {
	for _, input := range []string{strings.Repeat("<div>", 130) + "text" + strings.Repeat("</div>", 130), strings.Repeat("<span>x</span>", 50001), strings.Repeat("x", 3*1024*1024+1)} {
		if _, err := Article([]byte(input), "https://example.com/"); err == nil {
			t.Fatal("resource limit accepted")
		}
	}
}
func TestKnownOmissionWarns(t *testing.T) {
	body := `<article><h1>An illustrated archive</h1><p>` + strings.Repeat("This original article explains preservation through small and carefully collected examples. ", 20) + `</p><img src="https://example.com/a.png"><p>Closing paragraph.</p></article>`
	r, err := Article([]byte(body), "https://example.com/a")
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Warnings) == 0 {
		t.Fatal("omitted media was not disclosed")
	}
}
