package extract

import (
	"strings"
	"testing"
)

func TestCompletedStreamedArticleIsReadable(t *testing.T) {
	prose := strings.Repeat("The public tutorial explains project instructions and preserves complete examples for later reading. ", 20)
	body := `<html><head><title>Streamed tutorial</title></head><body><main><!--$?--><template id="B:3"></template><p>Loading fallback must disappear.</p><!--/$--></main><div hidden id="S:3"><div><h1>Streamed tutorial</h1><p>` + prose + `</p><pre><code class="language-md"># Project
  preserve indentation
</code></pre><!--$?--><template id="B:4"></template><p>Nested loading fallback.</p><!--/$--><p>Public closing paragraph.</p><script>window.attack = true</script><iframe src="https://example.com/active"></iframe></div></div><script>$RB=[];$RC=function(a,b){/* framework implementation */};$RC("B:3","S:3")</script><div hidden id="S:4"><p>Resolved nested content.</p></div><script>$RC("B:4","S:4")</script><div hidden id="S:5"><p>UNRESOLVED HIDDEN CONTENT</p></div></body></html>`
	r, err := Article([]byte(body), "https://example.com/tutorial")
	if err != nil || r.Document == nil {
		t.Fatalf("streamed article rejected: %+v %v", r, err)
	}
	got := documentText(r.Document.Blocks)
	for _, want := range []string{prose, "Public closing paragraph.", "Resolved nested content."} {
		if !strings.Contains(got, want) {
			t.Fatalf("streamed text lost: %q", want)
		}
	}
	for _, unwanted := range []string{"fallback", "UNRESOLVED", "window.attack"} {
		if strings.Contains(got, unwanted) {
			t.Fatalf("scaffolding or active content archived: %q", unwanted)
		}
	}
	for _, b := range r.Document.Blocks {
		if b.Kind == "code" && b.Language == "md" && b.Text == "# Project\n  preserve indentation\n" {
			return
		}
	}
	t.Fatal("streamed code formatting lost")
}

func TestUncompletedOrInvalidStreamRemainsHidden(t *testing.T) {
	prose := strings.Repeat("A hidden article must not be made readable merely because it resembles a streamed segment. ", 20)
	for _, tc := range []struct{ name, boundary, script, extra string }{
		{"no completion", `<!--$?--><template id="B:0"></template><!--/$-->`, "", ""},
		{"missing boundary markers", `<template id="B:0"></template>`, `$RC("B:0","S:0")`, ""},
		{"unclosed boundary", `<!--$?--><template id="B:0"></template>`, `$RC("B:0","S:0")`, ""},
		{"wrong segment", `<!--$?--><template id="B:0"></template><!--/$-->`, `$RC("B:0","S:1")`, ""},
		{"duplicate id", `<!--$?--><template id="B:0"></template><!--/$-->`, `$RC("B:0","S:0")`, `<div id="S:0"></div>`},
		{"script string", `<!--$?--><template id="B:0"></template><!--/$-->`, `const example = '$RC("B:0","S:0")'`, ""},
	} {
		t.Run(tc.name, func(t *testing.T) {
			body := `<html><head><title>Pending tutorial</title></head><body><main>` + tc.boundary + `</main><div hidden id="S:0"><h1>Hidden tutorial</h1><p>` + prose + `</p></div>` + tc.extra + `<script>` + tc.script + `</script></body></html>`
			r, err := Article([]byte(body), "https://example.com/pending")
			if err != nil || r.Document != nil || r.Reason != "article_unavailable" {
				t.Fatalf("unresolved stream exposed: %+v %v", r, err)
			}
		})
	}
}

func TestStreamCompletionPreservesAccessGates(t *testing.T) {
	body := `<main><!--$?--><template id="B:0"></template><!--/$--></main><div hidden id="S:0"><article><h1>Private preview</h1><p>` + strings.Repeat("This long preview requires authentication before the full article can be read. ", 20) + `</p><form><input type="password"></form></article></div><script>$RC("B:0","S:0")</script>`
	r, err := Article([]byte(body), "https://example.com/private")
	if err != nil || r.Document != nil || r.Reason != "article_unavailable" {
		t.Fatalf("streamed access gate bypassed: %+v %v", r, err)
	}
}
