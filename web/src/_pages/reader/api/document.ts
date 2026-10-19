export type Block = {
  kind:
    | "paragraph"
    | "heading"
    | "list"
    | "quote"
    | "code"
    | "text"
    | "strong"
    | "em"
    | "inline_code"
    | "link"
    | "br"
    | "list_item"
    | "table"
    | "table_head"
    | "table_body"
    | "table_foot"
    | "table_row"
    | "cell"
    | "header_cell"
    | "caption"
    | "details"
    | "summary";
  children?: Block[];
  href?: string;
  text?: string;
  language?: string;
  level?: number;
  ordered?: boolean;
  items?: string[];
};
export interface ArchivedArticle {
  title: string;
  submitted_url: string;
  generation: number;
  warnings: string[];
  document: { schema_version: 1 | 2; blocks: Block[] };
}
export class ReaderError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
export async function readArticle(
  id: string,
  signal: AbortSignal,
): Promise<ArchivedArticle> {
  const response = await fetch(
    `/api/links/${encodeURIComponent(id)}/document`,
    { cache: "no-store", credentials: "same-origin", signal },
  );
  if (!response.ok) {
    let code = "internal_error";
    try {
      code = (await response.json()).code ?? code;
    } catch {}
    throw new ReaderError(code, response.status);
  }
  const data = await response.json();
  if (
    !data ||
    typeof data.title !== "string" ||
    typeof data.submitted_url !== "string" ||
    !safeHref(data.submitted_url) ||
    ![1, 2].includes(data.document?.schema_version) ||
    !Array.isArray(data.document.blocks) ||
    !data.document.blocks.length ||
    data.document.blocks.length > 10000 ||
    !(data.document.schema_version === 1
      ? data.document.blocks.every(validBlock)
      : validTree(data.document.blocks))
  )
    throw new ReaderError("unsupported_document", 409);
  return data;
}
function validBlock(block: Block) {
  if (
    !block ||
    !["paragraph", "heading", "list", "quote", "code"].includes(block.kind)
  )
    return false;
  if (
    block.language !== undefined &&
    (block.kind !== "code" || !/^[a-z0-9_+#.-]{1,40}$/.test(block.language))
  )
    return false;
  if (block.kind === "list")
    return (
      Array.isArray(block.items) &&
      block.items.length > 0 &&
      block.items.every((text) => typeof text === "string")
    );
  return (
    typeof block.text === "string" &&
    (block.kind !== "heading" ||
      (Number.isInteger(block.level) && block.level! >= 2 && block.level! <= 6))
  );
}

function safeHref(value: unknown): value is string {
  if (typeof value !== "string" || /[\r\n\t]/.test(value)) return false;
  try {
    const u = new URL(value);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      !!u.hostname &&
      !u.username &&
      !u.password
    );
  } catch {
    return false;
  }
}
function validTree(blocks: Block[]): boolean {
  let count = 0,
    size = 0;
  const inline = new Set(["text", "strong", "em", "inline_code", "link", "br"]);
  const containers = new Set([
    "paragraph",
    "heading",
    "quote",
    "list",
    "list_item",
    "table",
    "table_head",
    "table_body",
    "table_foot",
    "table_row",
    "cell",
    "header_cell",
    "caption",
    "details",
    "summary",
    "strong",
    "em",
    "inline_code",
    "link",
  ]);
  const structural = new Set([
    "list_item",
    "table_head",
    "table_body",
    "table_foot",
    "table_row",
    "cell",
    "header_cell",
    "caption",
    "summary",
  ]);
  function visit(b: Block, parent: string, depth: number): boolean {
    if (!b || typeof b !== "object" || ++count > 10000 || depth > 64)
      return false;
    if (
      Object.keys(b).some(
        (k) =>
          ![
            "kind",
            "children",
            "href",
            "language",
            "text",
            "level",
            "ordered",
          ].includes(k),
      )
    )
      return false;
    size += (b.text?.length ?? 0) + (b.href?.length ?? 0);
    if (
      size > 3 * 1024 * 1024 ||
      (b.href !== undefined && (b.kind !== "link" || !safeHref(b.href))) ||
      (b.language !== undefined &&
        (b.kind !== "code" || !/^[a-z0-9_+#.-]{1,40}$/.test(b.language))) ||
      (b.level !== undefined && b.kind !== "heading") ||
      (b.ordered !== undefined &&
        (b.kind !== "list" || typeof b.ordered !== "boolean"))
    )
      return false;
    if (["text", "code"].includes(b.kind)) {
      if (
        typeof b.text !== "string" ||
        !b.text ||
        b.children !== undefined ||
        (b.kind === "code" && !b.text.trim())
      )
        return false;
    } else if (b.kind === "br") {
      if (b.text !== undefined || b.children !== undefined) return false;
    } else if (
      !containers.has(b.kind) ||
      b.text !== undefined ||
      !Array.isArray(b.children) ||
      !b.children.length
    )
      return false;
    if (
      b.kind === "heading" &&
      (!Number.isInteger(b.level) || b.level! < 1 || b.level! > 6)
    )
      return false;
    if (b.kind === "link" && !safeHref(b.href)) return false;
    if (
      [
        "paragraph",
        "heading",
        "strong",
        "em",
        "inline_code",
        "link",
        "summary",
        "caption",
      ].includes(parent)
    ) {
      if (!inline.has(b.kind) || (parent === "link" && b.kind === "link"))
        return false;
    } else if (parent === "list") {
      if (b.kind !== "list_item") return false;
    } else if (parent === "table") {
      if (
        ![
          "caption",
          "table_head",
          "table_body",
          "table_foot",
          "table_row",
        ].includes(b.kind)
      )
        return false;
    } else if (["table_head", "table_body", "table_foot"].includes(parent)) {
      if (b.kind !== "table_row") return false;
    } else if (parent === "table_row") {
      if (!["cell", "header_cell"].includes(b.kind)) return false;
    } else if (
      structural.has(b.kind) &&
      !(parent === "details" && b.kind === "summary")
    )
      return false;
    if (
      b.kind === "details" &&
      (b.children?.[0]?.kind !== "summary" ||
        b.children.slice(1).some((c) => c?.kind === "summary"))
    )
      return false;
    return !b.children || b.children.every((c) => visit(c, b.kind, depth + 1));
  }
  return blocks.every((b) => visit(b, "root", 0));
}
