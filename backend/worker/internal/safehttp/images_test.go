package safehttp

import (
	"bytes"
	"linkbook/linkprocessing"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestImageFetchUsesDestinationPolicyAndByteLimit(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/redirect":
			http.Redirect(w, r, "http://169.254.169.254/metadata", 302)
		case "/large":
			w.Header().Set("Content-Type", "image/png")
			_, _ = w.Write(bytes.Repeat([]byte{1}, linkprocessing.MaxImageBytes+1))
		default:
			w.Header().Set("Content-Type", "text/plain")
			_, _ = w.Write([]byte("image bytes"))
		}
	}))
	defer server.Close()
	c, err := ForFixture(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = c.FetchImage(t.Context(), server.URL+"/redirect"); Code(err) != "destination_blocked" {
		t.Fatalf("redirect: %v", err)
	}
	if _, err = c.FetchImage(t.Context(), server.URL+"/large"); Code(err) != "image_too_large" {
		t.Fatalf("limit: %v", err)
	}
	if body, err := c.FetchImage(t.Context(), server.URL); err != nil || string(body) != "image bytes" {
		t.Fatalf("%q %v", body, err)
	}
}
