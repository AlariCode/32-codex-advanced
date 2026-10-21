package worker

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/png"
	"linkbook/linkprocessing"
	"linkbook/worker/internal/safehttp"
	"strings"
	"testing"
)

type candidateFetcher struct {
	calls  []string
	data   []byte
	fail   bool
	cancel context.CancelFunc
}

func (f *candidateFetcher) FetchImage(ctx context.Context, s string) ([]byte, error) {
	f.calls = append(f.calls, s)
	if f.cancel != nil {
		f.cancel()
	}
	if f.fail || strings.Contains(s, "bad") {
		return f.data, errors.New("unavailable")
	}
	return f.data, nil
}
func TestCandidateFallbackBudgetsAndDeadline(t *testing.T) {
	var pngData bytes.Buffer
	_ = png.Encode(&pngData, image.NewGray(image.Rect(0, 0, 2, 2)))
	for _, name := range []string{"fallback", "attempts", "bytes", "deadline"} {
		t.Run(name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(t.Context())
			defer cancel()
			f := &candidateFetcher{data: pngData.Bytes()}
			candidates := []string{"https://example.com/bad", "https://example.com/good", "https://example.com/unused"}
			count := 1
			if name == "attempts" {
				f.fail = true
				count = 51
				candidates = nil
				for i := 0; i < 100; i++ {
					candidates = append(candidates, "https://example.com/bad")
				}
			}
			if name == "bytes" {
				f.fail = true
				f.data = make([]byte, linkprocessing.MaxImageBytes)
				count = 10
			}
			if name == "deadline" {
				f.cancel = cancel
			}
			d := linkprocessing.Document{SchemaVersion: 2}
			for i := 0; i < count; i++ {
				d.Blocks = append(d.Blocks, linkprocessing.Block{Kind: "image", Candidates: candidates, Omission: "image_not_saved", Alt: "Caption"})
			}
			r := linkprocessing.Result{Document: &d, Warnings: []string{"images_pending"}}
			archiveImages(ctx, f, &r)
			switch name {
			case "fallback":
				if len(f.calls) != 2 || len(r.Assets) != 1 || d.Blocks[0].AssetID == "" || len(r.Warnings) != 0 {
					t.Fatalf("%+v calls=%v", r, f.calls)
				}
			case "attempts":
				if len(f.calls) > 100 || len(r.Assets) != 0 {
					t.Fatalf("unbounded attempts %d", len(f.calls))
				}
			case "bytes":
				if len(f.calls) != 4 || len(r.Assets) != 0 {
					t.Fatalf("failed downloads bypass budget: %d", len(f.calls))
				}
			case "deadline":
				if len(f.calls) != 1 || len(r.Assets) != 0 {
					t.Fatalf("deadline ignored: %d", len(f.calls))
				}
			}
			for _, b := range d.Blocks {
				if len(b.Candidates) > 0 || b.Source != "" || b.Alt != "Caption" {
					t.Fatal("transient URLs or alt", b)
				}
			}
		})
	}
}
func TestPartialHTMLClassification(t *testing.T) {
	prose := strings.Repeat("A useful original article explains the practical details of long term preservation. ", 20)
	r := pageResult(safehttp.Page{HTML: []byte("<article><h1>Partial</h1><p>" + prose + "</p></article>"), FinalURL: "https://example.com/final", Truncated: true}, nil)
	if r.Document == nil || !containsWarning(r.Warnings, "html_truncated") {
		t.Fatalf("partial article: %+v", r)
	}
	r = pageResult(safehttp.Page{HTML: []byte("<html><title>Empty</title><body></body></html>"), Truncated: true, FinalURL: "https://example.com/"}, nil)
	if r.Document != nil || r.Reason != "article_unavailable" {
		t.Fatalf("absent article: %+v", r)
	}
	r = pageResult(safehttp.Page{}, errors.New("network failed"))
	if r.Document != nil || r.Reason != "network_error" {
		t.Fatalf("technical failure: %+v", r)
	}
}
func containsWarning(ws []string, w string) bool {
	for _, s := range ws {
		if s == w {
			return true
		}
	}
	return false
}

func TestParserResourceFailureStaysFailed(t *testing.T) {
	r := pageResult(safehttp.Page{HTML: []byte(strings.Repeat("<div>", 130) + "useful text" + strings.Repeat("</div>", 130)), FinalURL: "https://example.com/"}, nil)
	if r.Reason != "processing_error" || r.Document != nil {
		t.Fatalf("parser failure reclassified: %+v", r)
	}
}
