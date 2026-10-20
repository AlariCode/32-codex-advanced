package worker

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"linkbook/linkprocessing"
	"strings"
	"testing"
)

type imageFetcher struct {
	data  []byte
	calls int
}

func (f *imageFetcher) FetchImage(context.Context, string) ([]byte, error) {
	f.calls++
	return f.data, nil
}
func TestArchiveImageBudgetsAndPlaceholders(t *testing.T) {
	var buf bytes.Buffer
	_ = png.Encode(&buf, image.NewGray(image.Rect(0, 0, 2, 2)))
	for _, tc := range []struct {
		name              string
		count, size, want int
		omission          string
	}{
		{"count", 51, buf.Len(), 50, "image_count_limit"},
		{"single", 1, linkprocessing.MaxImageBytes + 1, 0, "image_too_large"},
		{"total", 5, linkprocessing.MaxImageBytes, 4, "image_total_limit"},
		{"corrupt", 1, 4, 0, "image_invalid"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			data := append([]byte(nil), buf.Bytes()...)
			if tc.name == "corrupt" {
				data = []byte("oops")
			} else if tc.size > len(data) {
				data = append(data, make([]byte, tc.size-len(data))...)
			}
			f := &imageFetcher{data: data}
			d := linkprocessing.Document{SchemaVersion: 2}
			for i := 0; i < tc.count; i++ {
				d.Blocks = append(d.Blocks, linkprocessing.Block{Kind: "image", Source: "https://images.example/" + strings.Repeat("x", i), Omission: "image_not_saved"})
			}
			r := linkprocessing.Result{Document: &d}
			archiveImages(t.Context(), f, &r)
			saved := 0
			for _, b := range d.Blocks {
				if b.AssetID != "" {
					saved++
				}
				if b.Source != "" {
					t.Fatal("source leaked")
				}
			}
			if saved != tc.want || d.Blocks[len(d.Blocks)-1].Omission != tc.omission || len(r.Warnings) == 0 {
				t.Fatalf("saved %d last %+v warnings %v", saved, d.Blocks[len(d.Blocks)-1], r.Warnings)
			}
			if tc.name == "count" && f.calls != 50 {
				t.Fatal("fetched beyond count budget")
			}
		})
	}
}
