package extract

import (
	"encoding/json"
	"linkbook/linkprocessing"
	"os"
	"reflect"
	"strings"
	"testing"
)

func TestRelativeLazySrcsetFixture(t *testing.T) {
	body, err := os.ReadFile("../../../../web/tests/fixtures/image-candidates.html")
	if err != nil {
		t.Fatal(err)
	}
	r, err := Article(body, "https://example.com/redirected/story")
	if err != nil {
		t.Fatal(err)
	}
	var images []linkprocessing.Block
	var walk func([]linkprocessing.Block)
	walk = func(bs []linkprocessing.Block) {
		for _, b := range bs {
			if b.Kind == "image" {
				images = append(images, b)
			}
			walk(b.Children)
		}
	}
	walk(r.Document.Blocks)
	want := [][]string{
		{"https://example.com/media/png"},
		{"https://example.com/media/jpeg", "https://example.com/media/invalid"},
		{"https://example.com/media/gif", "https://example.com/media/png"},
		{"https://example.com/media/jpeg", "https://example.com/media/gif"},
	}
	if len(images) != len(want) {
		t.Fatalf("positions: %+v", images)
	}
	for i, b := range images {
		if !reflect.DeepEqual(b.Candidates, want[i]) || b.Alt != []string{"Relative", "Lazy", "Srcset", "Combined"}[i] {
			t.Errorf("position %d: %+v want %v", i, b, want[i])
		}
	}
	raw, _ := json.Marshal(r.Document)
	if strings.Contains(string(raw), "https://example.com/media") || strings.Contains(string(raw), `"candidates":`) {
		t.Fatal("candidate URL leaked")
	}
	if strings.Count(string(raw), "Candidate caption") != 4 {
		t.Fatal("caption lost", string(raw))
	}
}

func TestCandidateBaseAndFinalURL(t *testing.T) {
	for _, tc := range []struct{ base, want string }{
		{"", "https://example.com/final/photo.png"},
		{`<base href="../media/">`, "https://example.com/media/photo.png"},
		{`<base href="javascript:alert(1)"><base href="https://other.example/">`, "https://example.com/final/photo.png"},
		{`<base href="https://cdn.example/pictures/">`, "https://cdn.example/pictures/photo.png"},
	} {
		body := tc.base + `<article><h1>Base resolution</h1><p>` + strings.Repeat("The archive resolves an illustration against the final address of the original story. ", 20) + `</p><img src="photo.png"></article>`
		r, err := Article([]byte(body), "https://example.com/final/story")
		if err != nil {
			t.Fatal(err)
		}
		raw := ""
		var walk func([]linkprocessing.Block)
		walk = func(bs []linkprocessing.Block) {
			for _, b := range bs {
				if b.Kind == "image" {
					raw = b.Source
				}
				walk(b.Children)
			}
		}
		walk(r.Document.Blocks)
		if raw != tc.want {
			t.Errorf("base %s: %s want %s", tc.base, raw, tc.want)
		}
	}
}

func TestWarningsOnlyDescribeSelectedMainContent(t *testing.T) {
	prose := strings.Repeat("The meaningful article paragraph explains how durable reading preserves the author's words. ", 15)
	for _, tc := range []struct {
		extra   string
		warning bool
	}{
		{`<aside><img src="/ad.png"><dl><dt>Advertising</dt></dl></aside>`, false},
		{`<article><p>` + prose + `</p><dl><dt>Important term</dt><dd>Important explanation</dd></dl></article>`, true},
	} {
		body := `<html><title>Preservation</title><body><article><h1>Preservation</h1><p>` + prose + `</p><p>Final article paragraph.</p></article>` + tc.extra + `</body></html>`
		r, err := Article([]byte(body), "https://example.com/story")
		if err != nil {
			t.Fatal(err)
		}
		warned := false
		for _, w := range r.Warnings {
			if w == "text_only_archive" || w == "text_incomplete" {
				warned = true
			}
		}
		if warned != tc.warning {
			t.Fatalf("warnings=%v want loss=%v", r.Warnings, tc.warning)
		}
	}
}

// Selection evidence must distinguish article loss from navigation removal.
func TestDroppedMainTextWarnsWithoutRestoringExcludedContent(t *testing.T) {
	body := `<article><h1>Preserving words</h1><p>` + strings.Repeat("A useful story describes archival reading in detail for future readers. ", 20) + `</p><p class="comment">UNSAVED MAIN PARAGRAPH ` + strings.Repeat("This separate original paragraph was detected inside the declared main article. ", 5) + `</p></article>`
	r, err := Article([]byte(body), "https://example.com/")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(r.Document)
	if strings.Contains(string(raw), "UNSAVED MAIN PARAGRAPH") {
		t.Fatal("fixture must exercise actual selection loss")
	}
	found := false
	for _, w := range r.Warnings {
		if w == "text_incomplete" {
			found = true
		}
	}
	if !found {
		t.Fatal("detected main text loss was silent", r.Warnings)
	}
}

func TestDroppedMainTableWarnsWithoutUnrelatedImageWarning(t *testing.T) {
	body := `<article><h1>Preserving a table</h1><p>` + strings.Repeat("The useful article explains how its table records important archival values. ", 20) + `</p><table class="comment"><tr><th>Important key</th><td>UNSAVED TABLE VALUE</td></tr></table></article>`
	r, err := Article([]byte(body), "https://example.com/")
	if err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(r.Document)
	if strings.Contains(string(raw), "UNSAVED TABLE VALUE") {
		t.Fatal("fixture must exercise actual selection loss")
	}
	found := false
	for _, w := range r.Warnings {
		if w == "text_incomplete" {
			found = true
		}
		if w == "images_omitted" {
			t.Fatal("table without images reported image loss")
		}
	}
	if !found {
		t.Fatal("detected main table loss was silent", r.Warnings)
	}
}

func TestSrcsetCommasBelongToURLsAndDataNeverBecomesRelativeCandidate(t *testing.T) {
	body := `<article><h1>Responsive images</h1><p>` + strings.Repeat("This original article describes how responsive illustrations are saved for durable reading. ", 15) + `</p><img srcset="data:image/png;base64,AAAA 1x, https://images.example/photo?v=1,2 2x" alt="Comma URL"></article>`
	r, err := Article([]byte(body), "https://example.com/story")
	if err != nil {
		t.Fatal(err)
	}
	var candidates []string
	var walk func([]linkprocessing.Block)
	walk = func(bs []linkprocessing.Block) {
		for _, b := range bs {
			if b.Kind == "image" {
				candidates = b.Candidates
			}
			walk(b.Children)
		}
	}
	walk(r.Document.Blocks)
	want := []string{"https://images.example/photo?v=1,2"}
	if !reflect.DeepEqual(candidates, want) {
		t.Fatalf("srcset URL parsing: %v want %v", candidates, want)
	}
}
