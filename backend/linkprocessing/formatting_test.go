package linkprocessing

import (
	"strings"
	"testing"
)

func TestVersionedFormattingValidation(t *testing.T) {
	valid := `{"schema_version":2,"blocks":[{"kind":"paragraph","children":[{"kind":"link","href":"https://example.com/a","children":[{"kind":"text","text":"safe"}]}]}]}`
	if _, err := DecodeDocument([]byte(valid)); err != nil {
		t.Fatal(err)
	}
	for _, raw := range []string{
		strings.Replace(valid, "https://example.com/a", "javascript:alert(1)", 1),
		strings.Replace(valid, "https://example.com/a", "//example.com/a", 1),
		strings.Replace(valid, `"kind":"link"`, `"kind":"link","onclick":"evil"`, 1),
		strings.Replace(valid, `"kind":"paragraph"`, `"kind":"iframe"`, 1),
		strings.Replace(valid, `"kind":"paragraph"`, `"kind":"table"`, 1),
		strings.Replace(valid, `"schema_version":2`, `"schema_version":99`, 1),
		valid + `{}`,
	} {
		if _, err := DecodeDocument([]byte(raw)); err == nil {
			t.Errorf("accepted %s", raw)
		}
	}
	if _, err := DecodeDocument([]byte(`{"schema_version":1,"blocks":[{"kind":"code","text":" x\n  y","language":"css"}]}`)); err != nil {
		t.Fatal(err)
	}
	deep := `{"kind":"text","text":"x"}`
	for range 70 {
		deep = `{"kind":"strong","children":[` + deep + `]}`
	}
	if _, err := DecodeDocument([]byte(`{"schema_version":2,"blocks":[{"kind":"paragraph","children":[` + deep + `]}]}`)); err == nil {
		t.Fatal("unbounded nesting")
	}
}
