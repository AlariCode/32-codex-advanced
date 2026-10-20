package linkprocessing

import (
	"bytes"
	"encoding/binary"
	"errors"
	"image"
	"image/gif"
	_ "image/jpeg"
	_ "image/png"
	"regexp"
)

const MaxImageBytes = 5 * 1024 * 1024
const MaxAssetBytes = 20 * 1024 * 1024
const MaxImages = 50
const MaxImageDimension = 8192
const MaxImagePixels = 16 * 1024 * 1024

type Asset struct {
	ID, MIME string
	Data     []byte
}

var assetID = regexp.MustCompile(`^[a-f0-9]{64}$`)

func ValidAssetID(id string) bool { return assetID.MatchString(id) }

var ErrImage = errors.New("image_invalid")

// ValidateImage checks signature/config before pixel allocation. Only static
// PNG, JPEG and GIF are accepted; animation is rejected before full decoding.
func ValidateImage(data []byte) (string, error) {
	if len(data) == 0 || len(data) > MaxImageBytes {
		return "", ErrImage
	}
	cfg, format, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil || cfg.Width < 1 || cfg.Height < 1 || cfg.Width > MaxImageDimension || cfg.Height > MaxImageDimension || int64(cfg.Width)*int64(cfg.Height) > MaxImagePixels {
		return "", ErrImage
	}
	switch format {
	case "png":
		// Inspect bounded chunks, rejecting APNG (including animation after IDAT).
		for pos := 8; pos+12 <= len(data); {
			size := int64(binary.BigEndian.Uint32(data[pos : pos+4]))
			end := int64(pos) + 12 + size
			if end > int64(len(data)) {
				return "", ErrImage
			}
			if string(data[pos+4:pos+8]) == "acTL" {
				return "", ErrImage
			}
			pos = int(end)
		}
	case "gif":
		if !staticGIF(data) {
			return "", ErrImage
		}
	case "jpeg":
	default:
		return "", ErrImage
	}
	decoded, actual, err := image.Decode(bytes.NewReader(data))
	if err != nil || actual != format || decoded.Bounds().Dx() != cfg.Width || decoded.Bounds().Dy() != cfg.Height {
		return "", ErrImage
	}
	// DecodeAll also validates a static GIF's trailer and extension blocks.
	if format == "gif" {
		if _, err = gif.DecodeAll(bytes.NewReader(data)); err != nil {
			return "", ErrImage
		}
	}
	return "image/" + format, nil
}

// Scan GIF blocks without allocating frames. Reject the second image descriptor.
func staticGIF(b []byte) bool {
	if len(b) < 13 {
		return false
	}
	pos := 13
	if b[10]&128 != 0 {
		pos += 3 * (1 << ((b[10] & 7) + 1))
	}
	frames := 0
	skip := func() bool {
		for pos < len(b) {
			n := int(b[pos])
			pos++
			if n == 0 {
				return true
			}
			if n > len(b)-pos {
				return false
			}
			pos += n
		}
		return false
	}
	for pos < len(b) {
		tag := b[pos]
		pos++
		switch tag {
		case 0x3b:
			return frames == 1
		case 0x21:
			if pos >= len(b) {
				return false
			}
			pos++
			if !skip() {
				return false
			}
		case 0x2c:
			frames++
			if frames > 1 || pos+9 > len(b) {
				return false
			}
			w, h := int(binary.LittleEndian.Uint16(b[pos+4:pos+6])), int(binary.LittleEndian.Uint16(b[pos+6:pos+8]))
			if w < 1 || h < 1 || int64(w)*int64(h) > MaxImagePixels || w > MaxImageDimension || h > MaxImageDimension {
				return false
			}
			flags := b[pos+8]
			pos += 9
			if flags&128 != 0 {
				pos += 3 * (1 << ((flags & 7) + 1))
			}
			if pos >= len(b) {
				return false
			}
			pos++
			if !skip() {
				return false
			}
		default:
			return false
		}
	}
	return false
}

func AssetReferences(d Document) map[string]bool {
	refs := map[string]bool{}
	var walk func([]Block)
	walk = func(bs []Block) {
		for _, b := range bs {
			if b.Kind == "image" && b.AssetID != "" {
				refs[b.AssetID] = true
			}
			walk(b.Children)
		}
	}
	walk(d.Blocks)
	return refs
}
func validateAssets(r Result) error {
	if r.Document == nil {
		if len(r.Assets) > 0 {
			return ErrImage
		}
		return nil
	}
	refs := AssetReferences(*r.Document)
	seen := map[string]bool{}
	total := 0
	if len(r.Assets) > MaxImages {
		return ErrImage
	}
	for _, a := range r.Assets {
		total += len(a.Data)
		if !ValidAssetID(a.ID) || seen[a.ID] || !refs[a.ID] || total > MaxAssetBytes {
			return ErrImage
		}
		mime, err := ValidateImage(a.Data)
		if err != nil || mime != a.MIME {
			return ErrImage
		}
		seen[a.ID] = true
	}
	if len(refs) != len(seen) {
		return ErrImage
	}
	var pending bool
	var walk func([]Block)
	walk = func(bs []Block) {
		for _, b := range bs {
			if b.Source != "" {
				pending = true
			}
			walk(b.Children)
		}
	}
	walk(r.Document.Blocks)
	if pending {
		return ErrImage
	}
	return nil
}
