package linkprocessing

import (
	"encoding/json"
	"errors"
	"io"
	"net/url"
	"regexp"
	"strings"
	"unicode/utf8"
)

const SchemaVersion = 2
const MaxHTMLBytes = 3 * 1024 * 1024

type Block struct {
	Children []Block  `json:"children,omitempty"`
	Href     string   `json:"href,omitempty"`
	Language string   `json:"language,omitempty"`
	Kind     string   `json:"kind"`
	Text     string   `json:"text,omitempty"`
	Level    int      `json:"level,omitempty"`
	Ordered  bool     `json:"ordered,omitempty"`
	Items    []string `json:"items,omitempty"`
}
type Document struct {
	SchemaVersion int     `json:"schema_version"`
	Blocks        []Block `json:"blocks"`
}
type Result struct {
	Document                *Document
	Title, FinalURL, Reason string
	Warnings                []string
}

var codeLanguage = regexp.MustCompile(`^[a-z0-9_+#.-]{1,40}$`)

var ErrDocument = errors.New("unsupported_document")

// ValidateDocument is shared by publication and reads; no HTML fallback exists.
func ValidateDocument(d Document) error {
	if d.SchemaVersion == 2 {
		return validateTree(d)
	}
	if d.SchemaVersion != 1 || len(d.Blocks) == 0 || len(d.Blocks) > 10000 {
		return ErrDocument
	}
	size := 0
	for _, b := range d.Blocks {
		if len(b.Children) != 0 || b.Href != "" || !utf8.ValidString(b.Text) {
			return ErrDocument
		}
		if b.Language != "" && (b.Kind != "code" || !codeLanguage.MatchString(b.Language)) {
			return ErrDocument
		}
		size += len(b.Text)
		switch b.Kind {
		case "paragraph", "quote", "code":
			if strings.TrimSpace(b.Text) == "" || b.Level != 0 || len(b.Items) != 0 || b.Ordered {
				return ErrDocument
			}
		case "heading":
			if b.Level < 2 || b.Level > 6 || strings.TrimSpace(b.Text) == "" || len(b.Items) != 0 || b.Ordered {
				return ErrDocument
			}
		case "list":
			if len(b.Items) == 0 || len(b.Items) > 1000 || b.Text != "" || b.Level != 0 {
				return ErrDocument
			}
			for _, s := range b.Items {
				if strings.TrimSpace(s) == "" || !utf8.ValidString(s) {
					return ErrDocument
				}
				size += len(s)
			}
		default:
			return ErrDocument
		}
	}
	if size > MaxHTMLBytes {
		return ErrDocument
	}
	return nil
}

func DecodeDocument(raw []byte) (Document, error) {
	var d Document
	decoder := json.NewDecoder(strings.NewReader(string(raw)))
	decoder.DisallowUnknownFields()
	// JSON can expand each text byte into a six-byte escape; leave room for
	// bounded block metadata too. Validation still caps decoded text at 3 MiB.
	if len(raw) > 8*MaxHTMLBytes || decoder.Decode(&d) != nil {
		return d, ErrDocument
	}
	if decoder.Decode(new(any)) != io.EOF {
		return d, ErrDocument
	}
	return d, ValidateDocument(d)
}

// SafeHref permits only absolute web URLs; relative references are resolved at extraction.
func SafeHref(value string) bool {
	u, err := url.Parse(value)
	return err == nil && (u.Scheme == "https" || u.Scheme == "http") && u.Hostname() != "" && u.User == nil && !strings.ContainsAny(value, "\r\n\t")
}

func validateTree(d Document) error {
	count, size := 0, 0
	var visit func(Block, string, int) bool
	inline := func(k string) bool { return strings.Contains("|text|strong|em|inline_code|link|br|", "|"+k+"|") }
	visit = func(b Block, parent string, depth int) bool {
		count++
		size += len(b.Text) + len(b.Href)
		if depth > 64 || count > 10000 || size > MaxHTMLBytes || !utf8.ValidString(b.Text) || len(b.Items) > 0 {
			return false
		}
		if b.Href != "" && (b.Kind != "link" || !SafeHref(b.Href)) {
			return false
		}
		if b.Language != "" && (b.Kind != "code" || !codeLanguage.MatchString(b.Language)) {
			return false
		}
		if b.Level != 0 && b.Kind != "heading" || b.Ordered && b.Kind != "list" {
			return false
		}
		switch b.Kind {
		case "text", "code":
			if b.Text == "" || len(b.Children) > 0 || b.Kind == "code" && strings.TrimSpace(b.Text) == "" {
				return false
			}
		case "br":
			if b.Text != "" || len(b.Children) > 0 {
				return false
			}
		case "paragraph", "heading", "quote", "list", "list_item", "table", "table_head", "table_body", "table_foot", "table_row", "cell", "header_cell", "caption", "details", "summary", "strong", "em", "inline_code", "link":
			if b.Text != "" || len(b.Children) == 0 {
				return false
			}
			if b.Kind == "heading" && (b.Level < 1 || b.Level > 6) {
				return false
			}
			if b.Kind == "link" && !SafeHref(b.Href) {
				return false
			}
		default:
			return false
		}
		// Validate content models so malformed archives cannot produce invalid DOM nesting.
		switch parent {
		case "paragraph", "heading", "strong", "em", "inline_code", "link", "summary", "caption":
			if !inline(b.Kind) || parent == "link" && b.Kind == "link" {
				return false
			}
		case "list":
			if b.Kind != "list_item" {
				return false
			}
		case "table":
			if b.Kind != "caption" && b.Kind != "table_head" && b.Kind != "table_body" && b.Kind != "table_foot" && b.Kind != "table_row" {
				return false
			}
		case "table_head", "table_body", "table_foot":
			if b.Kind != "table_row" {
				return false
			}
		case "table_row":
			if b.Kind != "cell" && b.Kind != "header_cell" {
				return false
			}
		default:
			if strings.Contains("|list_item|table_head|table_body|table_foot|table_row|cell|header_cell|caption|summary|", "|"+b.Kind+"|") && !(parent == "details" && b.Kind == "summary") {
				return false
			}
		}
		if b.Kind == "details" && b.Children[0].Kind != "summary" {
			return false
		}
		for i, c := range b.Children {
			if b.Kind == "details" && c.Kind == "summary" && i != 0 {
				return false
			}
			if !visit(c, b.Kind, depth+1) {
				return false
			}
		}
		return true
	}
	if len(d.Blocks) == 0 {
		return ErrDocument
	}
	for _, b := range d.Blocks {
		if !visit(b, "root", 0) {
			return ErrDocument
		}
	}
	return nil
}
