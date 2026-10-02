package link

import "testing"

func TestNormalizeURL(t *testing.T) {
	tests := []struct {
		name string
		raw  string
		want string
	}{
		{
			name: "already normalized",
			raw:  "https://example.com",
			want: "https://example.com",
		},
		{
			name: "upgrade HTTP to HTTPS",
			raw:  "http://example.com",
			want: "https://example.com",
		},
		{
			name: "lowercase scheme",
			raw:  "HTTPS://example.com",
			want: "https://example.com",
		},
		{
			name: "lowercase host and preserve path case",
			raw:  "HTTPS://EXAMPLE.COM/Articles/Go",
			want: "https://example.com/Articles/Go",
		},
		{
			name: "trim surrounding whitespace",
			raw:  " \t https://example.com \r\n",
			want: "https://example.com",
		},
		{
			name: "remove fragment",
			raw:  "https://example.com#cotent",
			want: "https://example.com",
		},
		{
			name: "remove UTM parameters",
			raw:  "https://example.com?utm_source=newsletter&utm_medium=email&utm_campaign=launch",
			want: "https://example.com",
		},
		{
			name: "remove every UTM parameter including duplicates and empty values",
			raw:  "https://example.com?utm_term=go&utm_content=button&utm_custom=x&utm_source=&utm_source=y",
			want: "https://example.com",
		},
		{
			name: "preserve meaningful query parameters",
			raw:  "https://example.com/search?q=golang&utm_source=email&page=2#results",
			want: "https://example.com/search?q=golang&page=2",
		},
		{
			name: "preserve repeated meaningful query parameters",
			raw:  "https://example.com/search?tag=go&utm_medium=email&tag=tdd",
			want: "https://example.com/search?tag=go&tag=tdd",
		},
		{
			name: "preserve escaped path and query data",
			raw:  "https://example.com/a%2Fb?q=hello%20world&utm_source=email#content",
			want: "https://example.com/a%2Fb?q=hello%20world",
		},
		{
			name: "combine normalization rules",
			raw:  " HTTP://EXAMPLE.COM/articles/Go?utm_source=email&id=42&utm_medium=social#cotent ",
			want: "https://example.com/articles/Go?id=42",
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeURL(tt.raw)
			if err != nil {
				t.Fatalf("NormalizeURL(%q) returned an unexpected error: %v", tt.raw, err)
			}
			if got != tt.want {
				t.Errorf("NormalizeURL(%q) = %q, want %q", tt.raw, got, tt.want)
			}
		})
	}
}

func TestNormalizeURLRejectsInvalidInput(t *testing.T) {
	tests := []struct {
		name string
		raw  string
	}{
		{name: "empty string", raw: ""},
		{name: "whitespace only", raw: " \t\r\n "},
		{name: "arbitrary text", raw: "this is not a URL"},
		{name: "host without scheme", raw: "example.com"},
		{name: "relative path", raw: "/articles/go"},
		{name: "scheme relative URL", raw: "//example.com"},
		{name: "missing host", raw: "https://"},
		{name: "path without host", raw: "https:///articles/go"},
		{name: "unsupported scheme", raw: "ftp://example.com"},
		{name: "email address", raw: "mailto:reader@example.com"},
		{name: "space inside host", raw: "https://exa mple.com"},
		{name: "invalid path escape", raw: "https://example.com/%zz"},
		{name: "invalid query escape", raw: "https://example.com?q=%zz"},
		{name: "invalid port", raw: "https://example.com:abc"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := NormalizeURL(tt.raw)
			if err == nil {
				t.Errorf("NormalizeURL(%q) returned no error, want an error", tt.raw)
			}
			if got != "" {
				t.Errorf("NormalizeURL(%q) = %q, want an empty result for invalid input", tt.raw, got)
			}
		})
	}
}
