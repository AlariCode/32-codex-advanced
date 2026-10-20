package linkprocessing

import (
	"bytes"
	"os"
	"strings"
	"testing"
)

func TestCommittedImageCorpus(t *testing.T) {
	for _, codec := range []string{"png", "jpeg", "gif"} {
		data, err := os.ReadFile("../../web/tests/fixtures/images/archive." + codec)
		if err != nil {
			t.Fatal(err)
		}
		mime, err := ValidateImage(data)
		if err != nil || mime != "image/"+codec {
			t.Fatalf("%s: %s %v", codec, mime, err)
		}
	}
}
func TestPublicationAssetsMatchReferences(t *testing.T) {
	data, err := os.ReadFile("../../web/tests/fixtures/images/archive.png")
	if err != nil {
		t.Fatal(err)
	}
	id := strings.Repeat("a", 64)
	d := Document{SchemaVersion: 2, Blocks: []Block{{Kind: "image", AssetID: id}}}
	asset := Asset{ID: id, MIME: "image/png", Data: data}
	for _, assets := range [][]Asset{nil, {asset, asset}, {{ID: id, MIME: "image/jpeg", Data: data}}, {{ID: strings.Repeat("b", 64), MIME: "image/png", Data: data}}} {
		if validateAssets(Result{Document: &d, Assets: assets}) == nil {
			t.Fatal("invalid assets accepted")
		}
	}
	if err := validateAssets(Result{Document: &d, Assets: []Asset{asset}}); err != nil {
		t.Fatal(err)
	}
	if err := validateAssets(Result{Assets: []Asset{asset}}); err == nil {
		t.Fatal("assets without document")
	}
	// APNG must be rejected even if the default PNG image would decode correctly.
	apng := append([]byte(nil), data[:33]...)
	apng = append(apng, []byte{0, 0, 0, 8, 'a', 'c', 'T', 'L', 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0}...)
	apng = append(apng, data[33:]...)
	if _, err := ValidateImage(apng); err == nil {
		t.Fatal("APNG accepted")
	}
	for _, data := range [][]byte{bytes.Repeat([]byte{0}, MaxImageBytes+1), []byte("<script>bad</script>")} {
		a := asset
		a.Data = data
		if validateAssets(Result{Document: &d, Assets: []Asset{a}}) == nil {
			t.Fatal("unsafe data published")
		}
	}
}
