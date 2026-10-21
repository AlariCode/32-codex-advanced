package extract

import (
	"golang.org/x/net/html"
	"linkbook/linkprocessing"
	"strings"
	"testing"
)

func TestArticleImagePositionAndCaption(t *testing.T) {
	body := `<html><title>Archive</title><body><article><h1>Archive</h1><p>` + strings.Repeat("This is the main article with enough meaningful text for extraction. ", 15) + `</p><figure><img src="https://images.example/photo.png" alt="An archived photo" onerror="alert(1)"><figcaption>Original caption</figcaption></figure><p><img src="/relative.png" alt="Relative"></p><p>Article ending.</p></article></body></html>`
	r, err := Article([]byte(body), "https://example.com/story")
	if err != nil {
		t.Fatal(err)
	}
	var sources, images int
	var caption bool
	var walk func([]linkprocessing.Block)
	walk = func(bs []linkprocessing.Block) {
		for _, b := range bs {
			if b.Kind == "image" {
				images++
				if b.Source == "https://images.example/photo.png" && b.Alt == "An archived photo" {
					sources++
				}
			}
			if b.Kind == "text" && strings.Contains(b.Text, "Original caption") {
				caption = true
			}
			walk(b.Children)
		}
	}
	walk(r.Document.Blocks)
	if sources != 1 || images != 2 || !caption {
		t.Fatalf("sources=%d images=%d caption=%v doc=%+v", sources, images, caption, r.Document)
	}
}

// Images may share a paragraph and inline wrappers with text. Restoring a
// marker must preserve every neighbouring node, including missing positions.
func TestArticleMixedImageParagraphPreservesEveryPosition(t *testing.T) {
	for _, content := range []string{
		`<p><img src="https://images.example/first.png" alt="First">Important middle text<img src="https://images.example/second.png" alt="Second">Closing text<img src="/missing.png" alt="Missing"></p>`,
		`<p>Opening text<strong><img src="https://images.example/first.png" alt="First">Important middle text</strong><a href="https://example.com/reference"><img src="https://images.example/second.png" alt="Second"></a>Closing text<img src="/missing.png" alt="Missing"></p>`,
	} {
		t.Run(content, func(t *testing.T) {
			body := `<html><title>Mixed images</title><body><article><h1>Mixed images</h1><p>` + strings.Repeat("This is the main article with enough meaningful text for extraction. ", 15) + `</p>` + content + `<p>Article ending.</p></article></body></html>`
			r, err := Article([]byte(body), "https://example.com/story")
			if err != nil {
				t.Fatal(err)
			}
			var positions []string
			var walk func([]linkprocessing.Block)
			walk = func(bs []linkprocessing.Block) {
				for _, b := range bs {
					switch b.Kind {
					case "image":
						if b.AssetID != "" || b.Omission == "" {
							t.Fatal("unprocessed image lost its placeholder", b)
						}
						positions = append(positions, b.Source+"|"+b.Alt+"|"+b.Omission)
					case "text":
						for _, value := range []string{"Important middle text", "Closing text"} {
							if strings.Contains(b.Text, value) {
								positions = append(positions, value)
							}
						}
						if strings.Contains(b.Text, "LINKBOOK") {
							t.Fatal("internal marker leaked", b.Text)
						}
					}
					walk(b.Children)
				}
			}
			walk(r.Document.Blocks)
			want := []string{"https://images.example/first.png|First|image_not_saved", "Important middle text", "https://images.example/second.png|Second|image_not_saved", "Closing text", "https://example.com/missing.png|Missing|image_not_saved"}
			if strings.Join(positions, "\n") != strings.Join(want, "\n") {
				t.Fatalf("positions:\n%v\nwant:\n%v", positions, want)
			}
		})
	}
}

func TestStructuredRestoresImagesInMergedText(t *testing.T) {
	const first = "LINKBOOKIMAGEFIRST:END"
	const second = "LINKBOOKIMAGESECOND:END"
	for _, prefix := range []string{"Before", "Literal LINKBOOKIMAGE prefix"} {
		root := &html.Node{Type: html.ElementNode, Data: "p"}
		root.AppendChild(&html.Node{Type: html.TextNode, Data: prefix + first + "Middle" + second + "After"})
		protected := map[string]*html.Node{}
		for _, marker := range []string{first, second} {
			protected[marker] = &html.Node{Type: html.ElementNode, Data: "img", Attr: []html.Attribute{{Key: "src", Val: "https://images.example/" + marker}}}
		}
		restored := map[string]bool{}
		bs := structured(root, nil, protected, restored)
		if len(bs) != 1 || bs[0].Kind != "paragraph" {
			t.Fatalf("paragraph lost: %+v", bs)
		}
		children := bs[0].Children
		if len(children) != 5 || children[0].Text != prefix || children[1].Source != "https://images.example/"+first || children[2].Text != "Middle" || children[3].Source != "https://images.example/"+second || children[4].Text != "After" || !restored[first] || !restored[second] {
			t.Fatalf("merged positions lost: %+v", children)
		}
	}
}
