package linkprocessing

import (
	"bytes"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"strings"
	"testing"
)

func TestImageCodecsAndLimits(t *testing.T) {
	im := image.NewRGBA(image.Rect(0, 0, 3, 2))
	im.Set(1, 1, color.RGBA{R: 200, A: 255})
	for _, codec := range []string{"png", "jpeg", "gif"} {
		t.Run(codec, func(t *testing.T) {
			var b bytes.Buffer
			switch codec {
			case "png":
				_ = png.Encode(&b, im)
			case "jpeg":
				_ = jpeg.Encode(&b, im, nil)
			case "gif":
				_ = gif.Encode(&b, im, nil)
			}
			mime, err := ValidateImage(b.Bytes())
			if err != nil || mime != "image/"+codec {
				t.Fatalf("%s %v", mime, err)
			}
			if _, err = ValidateImage(b.Bytes()[:len(b.Bytes())/2]); err == nil {
				t.Fatal("truncated image accepted")
			}
		})
	}
	for _, raw := range [][]byte{nil, []byte("<svg onload='alert(1)'/>"), []byte("RIFFxxxxWEBP"), bytes.Repeat([]byte{0}, MaxImageBytes+1)} {
		if _, err := ValidateImage(raw); err == nil {
			t.Fatal("invalid/oversized accepted")
		}
	}
	var huge bytes.Buffer
	_ = png.Encode(&huge, image.NewGray(image.Rect(0, 0, 8193, 1)))
	if _, err := ValidateImage(huge.Bytes()); err == nil {
		t.Fatal("dimension limit bypass")
	}
	huge.Reset()
	_ = png.Encode(&huge, image.NewGray(image.Rect(0, 0, 4097, 4096)))
	if _, err := ValidateImage(huge.Bytes()); err == nil {
		t.Fatal("pixel limit bypass")
	}
	var animated bytes.Buffer
	frame := image.NewPaletted(image.Rect(0, 0, 1, 1), color.Palette{color.Black, color.White})
	_ = gif.EncodeAll(&animated, &gif.GIF{Image: []*image.Paletted{frame, frame}, Delay: []int{1, 1}})
	if _, err := ValidateImage(animated.Bytes()); err == nil {
		t.Fatal("animation accepted")
	}
}

func TestImageDocumentValidation(t *testing.T) {
	id := strings.Repeat("a", 64)
	for _, b := range []Block{{Kind: "image", AssetID: id, Alt: "Photo"}, {Kind: "image", Omission: "image_invalid", Alt: "Missing"}} {
		d := Document{SchemaVersion: 2, Blocks: []Block{b}}
		if err := ValidateDocument(d); err != nil {
			t.Fatal(err)
		}
	}
	for _, b := range []Block{{Kind: "image"}, {Kind: "image", AssetID: "https://tracker.test/a"}, {Kind: "image", AssetID: id, Omission: "image_invalid"}, {Kind: "paragraph", Alt: "bad", Children: []Block{{Kind: "text", Text: "x"}}}} {
		if ValidateDocument(Document{SchemaVersion: 2, Blocks: []Block{b}}) == nil {
			t.Fatal("unsafe image document accepted")
		}
	}
}
