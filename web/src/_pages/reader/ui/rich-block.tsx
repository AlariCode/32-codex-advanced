import { createElement } from "react";
import type { Block } from "../api/document";
import { ArchivedImage } from "./archived-image";
import { CodeBlock } from "./code-block";
import styles from "./reader.module.css";

const tags = {
  figure: "figure",
  figcaption: "figcaption",
  paragraph: "p",
  quote: "blockquote",
  list_item: "li",
  strong: "strong",
  em: "em",
  inline_code: "code",
  table_head: "thead",
  table_body: "tbody",
  table_foot: "tfoot",
  table_row: "tr",
  cell: "td",
  header_cell: "th",
  caption: "caption",
  details: "details",
  summary: "summary",
} as const;

// All tags and props are selected here; archived data is never spread into React.
export function RichBlock({
  block,
  linkID,
  revalidate,
}: {
  block: Block;
  linkID: string;
  revalidate: () => void;
}) {
  const children = block.children?.map((child, index) => (
    <RichBlock
      key={index}
      block={child}
      linkID={linkID}
      revalidate={revalidate}
    />
  ));
  switch (block.kind) {
    case "image":
      return (
        <ArchivedImage block={block} linkID={linkID} revalidate={revalidate} />
      );
    case "text":
      return block.text;
    case "br":
      return <br />;
    case "code":
      return <CodeBlock text={block.text!} language={block.language} />;
    case "link":
      return (
        <a href={block.href} target="_blank" rel="noopener noreferrer">
          {children}
        </a>
      );
    case "heading": {
      const headings = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;
      return createElement(headings[block.level! - 1], null, children);
    }
    case "list":
      return block.ordered ? <ol>{children}</ol> : <ul>{children}</ul>;
    case "table":
      return (
        <div
          className={styles.tableScroll}
          tabIndex={0}
          role="region"
          aria-label="Таблица статьи"
        >
          <table>{children}</table>
        </div>
      );
    default: {
      const tag = tags[block.kind as keyof typeof tags];
      return tag ? createElement(tag, null, children) : null;
    }
  }
}
