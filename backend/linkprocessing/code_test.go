package linkprocessing

import "testing"

func TestCodeDocumentMetadata(t *testing.T) {
	for _, entry := range []struct {
		name, kind, text, language string
		valid                      bool
	}{
		{"css", "code", "* {\n margin: 0;\n}\n", "css", true},
		{"unknown language stays text", "code", "some code", "custom-lang", true},
		{"literal markup is safe text", "code", "<script>alert(1)</script>", "xml", true},
		{"invalid language", "code", "code", "css\" onclick=bad", false},
		{"non-code metadata", "paragraph", "prose", "css", false},
		{"blank code", "code", " \n\t", "css", false},
	} {
		t.Run(entry.name, func(t *testing.T) {
			err := ValidateDocument(Document{SchemaVersion: 1, Blocks: []Block{{Kind: entry.kind, Text: entry.text, Language: entry.language}}})
			if (err == nil) != entry.valid {
				t.Fatalf("valid=%v: %v", entry.valid, err)
			}
		})
	}
}
