export type Block = {
  kind: "paragraph" | "heading" | "list" | "quote" | "code";
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
  document: { schema_version: 1; blocks: Block[] };
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
    !/^https?:\/\//i.test(data.submitted_url) ||
    data.document?.schema_version !== 1 ||
    !Array.isArray(data.document.blocks) ||
    !data.document.blocks.length ||
    data.document.blocks.length > 10000 ||
    !data.document.blocks.every(validBlock)
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
