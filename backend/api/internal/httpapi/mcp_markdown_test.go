package httpapi

import (
	"linkbook/api/internal/link"
	"linkbook/linkprocessing"
	"strings"
	"testing"
	"unicode/utf8"
)

func TestMCPMarkdown(t *testing.T) {
	for _, version := range []int{1, 2} {
		d := link.DocumentResponse{Title: "Article", Document: linkprocessing.Document{SchemaVersion: version}}
		if version == 1 {
			d.Document.Blocks = []linkprocessing.Block{{Kind: "heading", Level: 2, Text: "Intro"}, {Kind: "paragraph", Text: "Hello"}, {Kind: "list", Ordered: true, Items: []string{"one", "two"}}, {Kind: "quote", Text: "quote"}}
		} else {
			d.Document.Blocks = []linkprocessing.Block{{Kind: "paragraph", Children: []linkprocessing.Block{{Kind: "strong", Children: []linkprocessing.Block{{Kind: "text", Text: "Hello"}}}, {Kind: "link", Href: "https://example.com", Children: []linkprocessing.Block{{Kind: "text", Text: "site"}}}}}}
		}
		d.Document.Blocks = append(d.Document.Blocks, linkprocessing.Block{Kind: "code", Language: "go", Text: "x := `code`\n```"})
		got := mcpArticleMarkdown(d)
		if !strings.Contains(got, "# Article") || !strings.Contains(got, "Hello") || !strings.Contains(got, "````go\nx := `code`\n```\n````") {
			t.Fatalf("markdown: %s", got)
		}
		if version == 1 && !strings.Contains(got, "1. one\n2. two") {
			t.Fatal(got)
		}
		if version == 2 && !strings.Contains(got, "**Hello**[site](<https://example.com>)") {
			t.Fatal(got)
		}
	}
	d := link.DocumentResponse{Document: linkprocessing.Document{Blocks: []linkprocessing.Block{{Kind: "paragraph", Text: strings.Repeat("я", mcpArticleMaxBytes)}}}}
	got := mcpArticleMarkdown(d)
	if len(got) > mcpArticleMaxBytes || !utf8.ValidString(got) || !strings.HasSuffix(got, mcpTruncatedNotice) {
		t.Fatalf("bad truncation: %d", len(got))
	}
}

func TestMCPMarkdownNestedContainers(t *testing.T) {
	text := func(s string) linkprocessing.Block { return linkprocessing.Block{Kind: "text", Text: s} }
	doc := link.DocumentResponse{Document: linkprocessing.Document{SchemaVersion: 2, Blocks: []linkprocessing.Block{
		{Kind: "list", Children: []linkprocessing.Block{{Kind: "list_item", Children: []linkprocessing.Block{
			{Kind: "paragraph", Children: []linkprocessing.Block{text("parent")}},
			{Kind: "list", Ordered: true, Children: []linkprocessing.Block{{Kind: "list_item", Children: []linkprocessing.Block{{Kind: "paragraph", Children: []linkprocessing.Block{text("child")}}}}}},
		}}}},
		{Kind: "table", Children: []linkprocessing.Block{{Kind: "table_row", Children: []linkprocessing.Block{{Kind: "cell", Children: []linkprocessing.Block{{Kind: "paragraph", Children: []linkprocessing.Block{text("a|b")}}}}, {Kind: "cell", Children: []linkprocessing.Block{{Kind: "paragraph", Children: []linkprocessing.Block{text("value")}}}}}}}},
		{Kind: "paragraph", Children: []linkprocessing.Block{{Kind: "inline_code", Children: []linkprocessing.Block{text("a`b")}}}},
	}}}
	if err := linkprocessing.ValidateDocument(doc.Document); err != nil {
		t.Fatal(err)
	}
	got := mcpArticleMarkdown(doc)
	for _, want := range []string{"- parent", "  1. child", "| --- | --- |", "| a\\|b | value |", "`` a`b ``"} {
		if !strings.Contains(got, want) {
			t.Fatalf("missing %q in %s", want, got)
		}
	}
}
