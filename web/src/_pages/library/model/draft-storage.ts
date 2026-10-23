import type { Draft } from "./library";
const key = (owner: string) => `linkbook:drafts:v1:${owner}`;
export function readDrafts(owner: string): { url: string; drafts: Draft[] } {
  const raw = localStorage.getItem(key(owner));
  if (!raw) return { url: "", drafts: [] };
  const data = JSON.parse(raw);
  if (
    data.user_id !== owner ||
    typeof data.url !== "string" ||
    !Array.isArray(data.drafts)
  )
    throw new Error("invalid_drafts");
  return {
    url: data.url,
    drafts: data.drafts
      .filter(
        (d: Draft) =>
          d &&
          d.user_id === owner &&
          typeof d.id === "string" &&
          typeof d.url === "string" &&
          typeof d.updated_at === "string" &&
          ["sending", "invalid", "error", "unknown"].includes(d.state),
      )
      .map((d: Draft) => ({
        ...d,
        state: d.state === "sending" ? "unknown" : d.state,
      })),
  };
}
export function writeDrafts(owner: string, url: string, drafts: Draft[]) {
  if (!url && !drafts.length) localStorage.removeItem(key(owner));
  else {
    let id = crypto.randomUUID();
    try {
      const existing = JSON.parse(localStorage.getItem(key(owner)) ?? "null");
      if (typeof existing?.id === "string") id = existing.id;
    } catch {
      /* Replace malformed local data on the next edit. */
    }
    localStorage.setItem(
      key(owner),
      JSON.stringify({
        id,
        user_id: owner,
        url,
        state: "unsent",
        updated_at: new Date().toISOString(),
        drafts,
      }),
    );
  }
}
