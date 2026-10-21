package worker

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"linkbook/linkprocessing"
	"linkbook/worker/internal/safehttp"
)

func TestRealCandidateArchiveSurvivesSourceShutdown(t *testing.T) {
	body, err := os.ReadFile("../../../../web/tests/fixtures/image-candidates.html")
	if err != nil {
		t.Fatal(err)
	}
	codecs := map[string][]byte{}
	for _, codec := range []string{"png", "jpeg", "gif"} {
		codecs[codec], err = os.ReadFile("../../../../web/tests/fixtures/images/archive." + codec)
		if err != nil {
			t.Fatal(err)
		}
	}
	calls := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		switch {
		case r.URL.Path == "/start":
			http.Redirect(w, r, "/redirected/story", 302)
		case r.URL.Path == "/redirected/story":
			w.Header().Set("Content-Type", "text/html")
			_, _ = w.Write(body)
		case strings.HasPrefix(r.URL.Path, "/media/"):
			data, ok := codecs[strings.TrimPrefix(r.URL.Path, "/media/")]
			if !ok {
				w.WriteHeader(404)
				return
			}
			_, _ = w.Write(data)
		default:
			w.WriteHeader(404)
		}
	}))
	defer s.Close()
	c, _ := safehttp.ForFixture(s.URL)
	page, err := c.Fetch(t.Context(), s.URL+"/start")
	r := pageResult(page, err)
	archiveImages(t.Context(), c, &r)
	if r.Document == nil || len(r.Assets) != 3 {
		t.Fatalf("archive: %+v", r)
	}
	s.Close()
	before := calls
	var ids []string
	var walk func([]linkprocessing.Block)
	walk = func(bs []linkprocessing.Block) {
		for _, b := range bs {
			if b.Kind == "image" {
				if b.Omission != "" {
					t.Fatal(b)
				}
				ids = append(ids, b.AssetID)
			}
			walk(b.Children)
		}
	}
	walk(r.Document.Blocks)
	if len(ids) != 4 || ids[1] != ids[3] {
		t.Fatal("duplicated variants or lost positions", ids)
	}
	for _, a := range r.Assets {
		if _, err := linkprocessing.ValidateImage(a.Data); err != nil {
			t.Fatal(err)
		}
	}
	raw, _ := json.Marshal(r.Document)
	if strings.Contains(string(raw), s.URL) || calls != before {
		t.Fatal("source dependency")
	}
}

func TestUnsafeBaseAndRedirectFallbackUseSameNetworkPolicy(t *testing.T) {
	data, err := os.ReadFile("../../../../web/tests/fixtures/images/archive.png")
	if err != nil {
		t.Fatal(err)
	}
	hits := 0
	s := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		if r.URL.Path == "/redirect" {
			http.Redirect(w, r, "http://169.254.169.254/metadata", 302)
			return
		}
		_, _ = w.Write(data)
	}))
	defer s.Close()
	c, _ := safehttp.ForFixture(s.URL)
	for _, base := range []string{"http://127.0.0.1:39877/", "http://169.254.169.254/"} {
		body := `<html><head><base href="` + base + `"></head><body><article><h1>Safe alternatives</h1><p>` + strings.Repeat("This article preserves its useful illustration despite blocked candidate destinations. ", 20) + `</p><figure><img data-src="forbidden" srcset="` + s.URL + `/redirect 2x, ` + s.URL + `/png 1x" alt="Safe picture"><figcaption>Safe caption</figcaption></figure></article></body></html>`
		r := pageResult(safehttp.Page{HTML: []byte(body), FinalURL: s.URL + "/story"}, nil)
		before := hits
		archiveImages(t.Context(), c, &r)
		if len(r.Assets) != 1 || hits-before != 2 {
			t.Fatalf("fallback failed or connected to blocked host: assets=%d hits=%d warnings=%v", len(r.Assets), hits-before, r.Warnings)
		}
	}
}
