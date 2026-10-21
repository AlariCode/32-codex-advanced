package worker

import (
	"errors"
	"linkbook/worker/internal/safehttp"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestNonArticleHTTPAndNetworkClassification(t *testing.T) {
	for _, tc := range []struct {
		status          int
		content, reason string
	}{
		{200, "application/pdf", "article_unavailable"},
		{200, "video/mp4", "article_unavailable"},
		{401, "text/html", "article_unavailable"},
		{403, "text/html", "article_unavailable"},
		{404, "text/html", "http_error"},
	} {
		t.Run(tc.content+http.StatusText(tc.status), func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				w.Header().Set("Content-Type", tc.content)
				w.WriteHeader(tc.status)
				_, _ = w.Write([]byte("unavailable"))
			}))
			defer server.Close()
			client, err := safehttp.ForFixture(server.URL)
			if err != nil {
				t.Fatal(err)
			}
			page, err := client.Fetch(t.Context(), server.URL)
			result := pageResult(page, err)
			if result.Document != nil || result.Reason != tc.reason {
				t.Fatalf("result %+v fetch %v", result, err)
			}
		})
	}
	if r := pageResult(safehttp.Page{}, errors.New("offline")); r.Reason != "network_error" {
		t.Fatalf("%+v", r)
	}
}
