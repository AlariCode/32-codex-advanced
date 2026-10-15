package linkprocessing

import (
	"encoding/json"
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"
)

const SchemaVersion = 1
const MaxHTMLBytes = 3 * 1024 * 1024

type Block struct {
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
	if d.SchemaVersion != SchemaVersion || len(d.Blocks) == 0 || len(d.Blocks) > 10000 {
		return ErrDocument
	}
	size := 0
	for _, b := range d.Blocks {
		if !utf8.ValidString(b.Text) {
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
	return d, ValidateDocument(d)
}
