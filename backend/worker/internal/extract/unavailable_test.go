package extract

import (
	"os"
	"strings"
	"testing"
)

func TestUnavailableClassesAndTitleFallback(t *testing.T) {
	for _, name := range []string{"homepage", "video", "login", "paywall", "js-only"} {
		t.Run(name, func(t *testing.T) {
			body, err := os.ReadFile("../../../../web/tests/fixtures/" + name + ".html")
			if err != nil {
				t.Fatal(err)
			}
			r, err := Article(body, "https://example.com/"+name)
			if err != nil || r.Document != nil || r.Reason != "article_unavailable" || r.Title != "Fixture "+name {
				t.Fatalf("unexpected result: %+v %v", r, err)
			}
		})
	}
	for _, tc := range []struct{ html, title string }{
		{"<html><head><meta property='og:title' content='Metadata title'></head><body></body></html>", "Metadata title"},
		{"<html><body></body></html>", "example.com"},
	} {
		r, err := Article([]byte(tc.html), "https://example.com/empty")
		if err != nil || r.Title != tc.title {
			t.Fatalf("title=%q want=%q err=%v", r.Title, tc.title, err)
		}
	}
}

func TestAccessGatesDoNotBecomeReadablePreviews(t *testing.T) {
	for _, gate := range []string{`<form><input type="password"></form>`, `<script type="application/ld+json">{"isAccessibleForFree": false}</script>`} {
		body := `<html><head><title>Private preview</title></head><body><article><h1>Private preview</h1><p>` + strings.Repeat("This is a long preview that must never become an archived article behind an access gate. ", 20) + `</p>` + gate + `</article></body></html>`
		result, err := Article([]byte(body), "https://example.com/private")
		if err != nil || result.Document != nil || result.Reason != "article_unavailable" {
			t.Fatalf("access gate bypass: %+v %v", result, err)
		}
	}
}

func TestVideoAndHomepageCannotUseDescriptionsAsArticle(t *testing.T) {
	description := strings.Repeat("A description of the available content provides useful information without being the actual article. ", 8)
	for _, body := range []string{
		`<main><video src="movie.mp4"></video><p>` + description + `</p></main>`,
		`<main><article><h2><a href="/one">First story</a></h2><p>` + description + `</p></article><article><h2><a href="/two">Second story</a></h2><p>` + description + `</p></article></main>`,
	} {
		r, err := Article([]byte(body), "https://example.com/")
		if err != nil || r.Document != nil || r.Reason != "article_unavailable" {
			t.Fatalf("non-article content: %+v %v", r, err)
		}
	}
}

func TestPublicArticleWithLinkedSubheadingAndRecommendationStaysReadable(t *testing.T) {
	prose := strings.Repeat("A complete public article explains durable storage with detailed examples and practical techniques for preserving knowledge. ", 15)
	conclusion := "The complete written conclusion remains freely available."
	for _, heading := range []string{"h1", "h2", "h3"} {
		for _, position := range []string{"before", "after", "nested"} {
			t.Run(heading+"/"+position, func(t *testing.T) {
				recommendation := `<article><h2><a href="/related">Related story</a></h2><p>A short recommendation of another article.</p></article>`
				content := `<h1>Public written article</h1><p>` + prose + `</p><` + heading + `><a href="/guide">Further practical guidance</a></` + heading + `><p>` + conclusion + `</p>`
				body := `<article>` + content + `</article>`
				switch position {
				case "before":
					body = `<section>` + recommendation + `</section>` + body
				case "after":
					body += `<section>` + recommendation + `</section>`
				case "nested":
					body = `<article>` + content + `<section>` + recommendation + `</section></article>`
				}
				r, err := Article([]byte(`<html><head><title>Public written article</title></head><body><main>`+body+`</main></body></html>`), "https://example.com/public")
				if err != nil || r.Document == nil || r.Reason != "" {
					t.Fatalf("public article rejected: %+v %v", r, err)
				}
				archived := documentText(r.Document.Blocks)
				if !strings.Contains(archived, prose) || !strings.Contains(archived, conclusion) {
					t.Fatalf("public article text lost: %s", archived)
				}
			})
		}
	}
}

func TestPublicArticleWithProseBeforeLinkedHeadingAndRecommendationStaysReadable(t *testing.T) {
	prose := strings.Repeat("The public article begins directly with a detailed explanation of durable archives and practical examples for preserving knowledge. ", 15)
	conclusion := "The complete conclusion remains freely available."
	body := `<html><head><title>Public written article</title></head><body><main><article><p>` + prose + `</p><h2><a href="/guide">Further practical guidance</a></h2><p>` + conclusion + `</p></article><section><article><h2><a href="/related">Related story</a></h2><p>A short recommendation.</p></article></section></main></body></html>`
	r, err := Article([]byte(body), "https://example.com/public")
	if err != nil || r.Document == nil || r.Reason != "" {
		t.Fatalf("public article rejected: %+v %v", r, err)
	}
	archived := documentText(r.Document.Blocks)
	if !strings.Contains(archived, prose) || !strings.Contains(archived, conclusion) {
		t.Fatalf("public article text lost: %s", archived)
	}
}

func TestAvailableArticleIgnoresUnrelatedLoginAndEmbeddedFrames(t *testing.T) {
	prose := strings.Repeat("A complete public article explains how a durable archive preserves every meaningful paragraph for later reading. ", 15)
	for _, container := range []string{"article", "main", "div"} {
		for _, extra := range []string{
			`<form action="/login"><label>Account password<input type="password"></label></form>`,
			`<header><form action="/login"><input type="password"></form></header>`,
			`<iframe src="https://example.com/embed/widget"></iframe>`,
		} {
			t.Run(container+extra, func(t *testing.T) {
				body := `<html><head><title>Public archive</title></head><body>` + extra + `<` + container + `><h1>Public archive</h1><p>` + prose + `</p><p>Public closing paragraph.</p></` + container + `></body></html>`
				r, err := Article([]byte(body), "https://example.com/public")
				if err != nil || r.Document == nil || r.Reason != "" {
					t.Fatalf("public article rejected: %+v %v", r, err)
				}
				if !strings.Contains(documentText(r.Document.Blocks), prose) {
					t.Fatal("public article text lost")
				}
			})
		}
	}
}

func TestAvailableMainArticleWithEmbeddedIframeAndAccountHeader(t *testing.T) {
	prose := strings.Repeat("A complete public article explains durable archiving with useful details and practical examples. ", 15)
	body := `<main><header><form><input type="password"></form></header><h1>Public archive</h1><p>` + prose + `</p><iframe src="https://example.com/embed"></iframe><p>Public closing paragraph.</p></main>`
	r, err := Article([]byte(body), "https://example.com/public")
	if err != nil || r.Document == nil || r.Reason != "" {
		t.Fatalf("public main rejected: %+v %v", r, err)
	}
	if !strings.Contains(documentText(r.Document.Blocks), prose) {
		t.Fatal("public article text lost")
	}
}

func TestPublicMainNarrativeWithEmbeddedVideoStaysReadable(t *testing.T) {
	prose := strings.Repeat("This public written article explains durable storage and practical techniques for preserving knowledge. ", 15)
	for _, position := range []string{"before", "inside", "after"} {
		t.Run(position, func(t *testing.T) {
			video := `<video controls src="/example.mp4"></video>`
			content := `<h1>Public written article</h1><p>` + prose + `</p><p>The written conclusion remains freely available.</p>`
			if position == "before" {
				content = video + content
			} else if position == "after" {
				content += video
			} else {
				content = strings.Replace(content, "</p>", "</p>"+video, 1)
			}
			r, err := Article([]byte(`<html><head><title>Public written article</title></head><body><main>`+content+`</main></body></html>`), "https://example.com/public")
			if err != nil || r.Document == nil || r.Reason != "" {
				t.Fatalf("public narrative rejected: %+v %v", r, err)
			}
			archived := documentText(r.Document.Blocks)
			if !strings.Contains(archived, prose) || !strings.Contains(archived, "The written conclusion remains freely available.") {
				t.Fatalf("public text lost: %s", archived)
			}
		})
	}
}

func TestMandatorySiblingLoginGatesBlockArticlePreview(t *testing.T) {
	preview := `<article><h1>Private article preview</h1><p>` + strings.Repeat("This is only a preview of an article that requires authentication before it can be read in full. ", 15) + `</p></article>`
	for _, gate := range []string{
		`<form action="/login"><p>Sign in to continue reading</p><input type="password"><button>Sign in</button></form>`,
		`<section aria-label="Log in to read the full article"><form><input type="password"><button>Log in</button></form></section>`,
		`<form aria-label="Войдите, чтобы прочитать статью"><input type="email"><button>Отправить ссылку</button></form>`,
	} {
		for _, position := range []string{"before", "after"} {
			t.Run(position+gate, func(t *testing.T) {
				content := preview + gate
				if position == "before" {
					content = gate + preview
				}
				r, err := Article([]byte(`<html><head><title>Private preview</title></head><body>`+content+`</body></html>`), "https://example.com/private")
				if err != nil || r.Document != nil || r.Reason != "article_unavailable" {
					t.Fatalf("mandatory sibling gate bypassed: %+v %v", r, err)
				}
			})
		}
	}
}

func TestDeclaredVideoPageDoesNotArchiveItsLongDescription(t *testing.T) {
	body := `<html><head><title>Recorded lecture</title><meta property="og:type" content="video.other"></head><body><main><h1>Recorded lecture</h1><video src="/lecture.mp4"></video><p>` + strings.Repeat("This description explains what the lecture covers but is not a written version of the video. ", 15) + `</p><p>Watch the recording for the complete lecture.</p></main></body></html>`
	r, err := Article([]byte(body), "https://example.com/recording")
	if err != nil || r.Document != nil || r.Reason != "article_unavailable" {
		t.Fatalf("video description archived: %+v %v", r, err)
	}
}
