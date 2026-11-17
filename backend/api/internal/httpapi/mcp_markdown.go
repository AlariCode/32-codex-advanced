package httpapi

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"linkbook/api/internal/link"
	"linkbook/linkprocessing"
)

const mcpArticleMaxBytes = 100 * 1024
const mcpTruncatedNotice = "\n\n[Article truncated: Markdown exceeds the 100 KiB resource limit.]"

var mcpMarkdownEscaper = strings.NewReplacer("\\", "\\\\", "*", "\\*", "_", "\\_", "[", "\\[", "]", "\\]", "`", "\\`", "<", "&lt;", ">", "&gt;", "#", "\\#", "|", "\\|")

func mcpArticleMarkdown(doc link.DocumentResponse) string {
	text := "# " + mcpMarkdownEscaper.Replace(doc.Title) + "\n\n" + renderMCPBlocks(doc.Document.Blocks)
	if len(text) <= mcpArticleMaxBytes {
		return text
	}
	end := mcpArticleMaxBytes - len(mcpTruncatedNotice)
	for !utf8.RuneStart(text[end]) {
		end--
	}
	return text[:end] + mcpTruncatedNotice
}

func renderMCPBlocks(blocks []linkprocessing.Block) string {
	var out strings.Builder
	for _, b := range blocks {
		out.WriteString(renderMCPBlock(b))
	}
	return out.String()
}

func mcpBacktickFence(text string, minimum int) string {
	longest, run := 0, 0
	for _, c := range text {
		if c == '`' {
			run++
			if run > longest {
				longest = run
			}
		} else {
			run = 0
		}
	}
	if longest+1 > minimum {
		minimum = longest + 1
	}
	return strings.Repeat("`", minimum)
}

func renderMCPBlock(b linkprocessing.Block) string {
	var content string
	// Containers with custom rendering traverse their children below, exactly once.
	switch b.Kind {
	case "list", "table", "inline_code", "code":
	default:
		content = renderMCPBlocks(b.Children)
	}
	if b.Text != "" {
		content = mcpMarkdownEscaper.Replace(b.Text)
	}
	switch b.Kind {
	case "text":
		return content
	case "br":
		return "  \n"
	case "strong":
		return "**" + content + "**"
	case "em":
		return "*" + content + "*"
	case "inline_code":
		// Children are text/formatting nodes; recover literal text before fencing.
		var literal func([]linkprocessing.Block) string
		literal = func(nodes []linkprocessing.Block) string {
			var s strings.Builder
			for _, n := range nodes {
				s.WriteString(n.Text)
				s.WriteString(literal(n.Children))
				if n.Kind == "br" {
					s.WriteByte('\n')
				}
			}
			return s.String()
		}
		raw := literal(b.Children)
		fence := mcpBacktickFence(raw, 1)
		return fence + " " + raw + " " + fence
	case "link":
		return "[" + content + "](<" + strings.ReplaceAll(strings.ReplaceAll(b.Href, "<", "%3C"), ">", "%3E") + ">)"
	case "paragraph", "caption", "figcaption", "summary":
		return content + "\n\n"
	case "heading":
		return strings.Repeat("#", b.Level) + " " + content + "\n\n"
	case "quote":
		return "> " + strings.ReplaceAll(strings.TrimSpace(content), "\n", "\n> ") + "\n\n"
	case "code":
		fence := mcpBacktickFence(b.Text, 3)
		return fence + b.Language + "\n" + b.Text + "\n" + fence + "\n\n"
	case "list":
		var out strings.Builder
		items := b.Items // Schema v1 stores plain strings; v2 stores list_item children.
		if len(b.Children) > 0 {
			items = make([]string, 0, len(b.Children))
			for _, item := range b.Children {
				items = append(items, renderMCPBlocks(item.Children))
			}
		} else {
			items = append([]string(nil), items...)
			for i := range items {
				items[i] = mcpMarkdownEscaper.Replace(items[i])
			}
		}
		for i, item := range items {
			prefix := "- "
			if b.Ordered {
				prefix = fmt.Sprintf("%d. ", i+1)
			}
			out.WriteString(prefix + strings.ReplaceAll(strings.TrimSpace(item), "\n", "\n"+strings.Repeat(" ", len(prefix))) + "\n")
		}
		return out.String() + "\n"
	case "image":
		return "[Image: " + mcpMarkdownEscaper.Replace(b.Alt) + "]"
	case "table":
		// All rows become a Markdown table; use a blank header to preserve data rows.
		var rows []linkprocessing.Block
		var collect func([]linkprocessing.Block)
		collect = func(nodes []linkprocessing.Block) {
			for _, n := range nodes {
				if n.Kind == "table_row" {
					rows = append(rows, n)
				} else {
					collect(n.Children)
				}
			}
		}
		collect(b.Children)
		columns := 0
		for _, row := range rows {
			if len(row.Children) > columns {
				columns = len(row.Children)
			}
		}
		var out strings.Builder
		for _, child := range b.Children {
			if child.Kind == "caption" {
				out.WriteString(renderMCPBlock(child))
			}
		}
		out.WriteString("|" + strings.Repeat(" |", columns) + "\n|" + strings.Repeat(" --- |", columns) + "\n")
		for _, row := range rows {
			out.WriteString("|")
			for _, cell := range row.Children {
				out.WriteString(" " + strings.ReplaceAll(strings.TrimSpace(renderMCPBlocks(cell.Children)), "\n", "<br>") + " |")
			}
			out.WriteString(strings.Repeat(" |", columns-len(row.Children)) + "\n")
		}
		return out.String() + "\n"
	default:
		return content
	}
}
