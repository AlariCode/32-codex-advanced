package worker

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/png"
	"linkbook/linkprocessing"
	"linkbook/worker/internal/safehttp"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
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

// The production media path must reuse sockets only within this archive, while
// still downloading/charging each image position rather than caching content.
func TestArchiveImageConnectionScope(t *testing.T) {
	data, err := os.ReadFile("../../../../web/tests/fixtures/images/archive.png")
	if err != nil {
		t.Fatal(err)
	}
	var connections, requests atomic.Int32
	s := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); _, _ = w.Write(data) }))
	s.Config.ConnState = func(_ net.Conn, state http.ConnState) {
		if state == http.StateNew {
			connections.Add(1)
		}
	}
	s.Start()
	defer s.Close()
	c, err := safehttp.ForFixture(s.URL)
	if err != nil {
		t.Fatal(err)
	}
	var previous string
	for i := 0; i < 2; i++ {
		r := linkprocessing.Result{Document: &linkprocessing.Document{SchemaVersion: 2, Blocks: []linkprocessing.Block{{Kind: "image", Source: s.URL + "/image"}, {Kind: "image", Source: s.URL + "/image"}}}, Warnings: []string{"images_pending"}}
		archiveImages(t.Context(), c, &r)
		if len(r.Assets) != 1 || len(r.Warnings) != 0 || r.Document.Blocks[0].AssetID == "" || r.Document.Blocks[0].AssetID != r.Document.Blocks[1].AssetID {
			t.Fatalf("archive: %+v", r)
		}
		if previous != "" && previous != r.Document.Blocks[0].AssetID {
			t.Fatal("connection reuse changed asset identity")
		}
		previous = r.Document.Blocks[0].AssetID
	}
	if connections.Load() != 2 || requests.Load() != 4 {
		t.Fatalf("connections=%d requests=%d", connections.Load(), requests.Load())
	}
}

func TestArchiveSessionChargesRepeatedAndInvalidDownloads(t *testing.T) {
	png, err := os.ReadFile("../../../../web/tests/fixtures/images/archive.png")
	if err != nil {
		t.Fatal(err)
	}
	for _, valid := range []bool{false, true} {
		t.Run(fmt.Sprint(valid), func(t *testing.T) {
			data := make([]byte, linkprocessing.MaxImageBytes)
			if valid {
				copy(data, png)
			}
			var requests atomic.Int32
			s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { requests.Add(1); _, _ = w.Write(data) }))
			defer s.Close()
			c, _ := safehttp.ForFixture(s.URL)
			r := linkprocessing.Result{Document: &linkprocessing.Document{SchemaVersion: 2}}
			for i := 0; i < 5; i++ {
				r.Document.Blocks = append(r.Document.Blocks, linkprocessing.Block{Kind: "image", Source: s.URL + "/same"})
			}
			archiveImages(t.Context(), c, &r)
			if requests.Load() != 4 || r.Document.Blocks[4].Omission != "image_total_limit" || !containsWarning(r.Warnings, "images_omitted") {
				t.Fatalf("budget bypass: requests=%d result=%+v", requests.Load(), r)
			}
			wantAssets := 0
			if valid {
				wantAssets = 1
			}
			if len(r.Assets) != wantAssets {
				t.Fatalf("assets=%d", len(r.Assets))
			}
			for _, b := range r.Document.Blocks[:4] {
				if valid && b.AssetID == "" || !valid && b.Omission != "image_invalid" {
					t.Fatalf("position: %+v", b)
				}
			}
		})
	}
}
