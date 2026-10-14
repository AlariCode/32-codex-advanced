import type { UserDTO } from "@/shared/api";
import type { LinkCard } from "../model/library";

export class LibraryError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
async function request(
  path: string,
  signal: AbortSignal,
  body?: { url: string },
) {
  const response = await fetch(path, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    credentials: "same-origin",
    signal,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
    let code = "internal_error";
    try {
      code = (await response.json()).code ?? code;
    } catch {
      /* Transport status still identifies 401. */
    }
    throw new LibraryError(response.status, code);
  }
  return response.json();
}
function isCard(value: LinkCard) {
  return (
    value &&
    typeof value.id === "string" &&
    typeof value.submitted_url === "string" &&
    /^https?:\/\//i.test(value.submitted_url) &&
    typeof value.created_at === "string" &&
    ["processing", "ready", "unavailable", "failed"].includes(value.state)
  );
}
export async function currentUser(signal: AbortSignal): Promise<UserDTO> {
  const user = await request("/api/users/me", signal);
  if (!user || typeof user.id !== "string" || typeof user.email !== "string")
    throw new Error("invalid_response");
  return user;
}
export async function listLinks(
  signal: AbortSignal,
  cursor = "",
): Promise<{ links: LinkCard[]; next_cursor: string }> {
  const page = await request(
    `/api/links?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`,
    signal,
  );
  if (
    !Array.isArray(page.links) ||
    !page.links.every(isCard) ||
    typeof page.next_cursor !== "string"
  )
    throw new Error("invalid_response");
  return page;
}
export async function saveLink(
  signal: AbortSignal,
  url: string,
): Promise<{ link: LinkCard; created: boolean }> {
  const result = await request("/api/links", signal, { url });
  if (!isCard(result.link) || typeof result.created !== "boolean")
    throw new Error("invalid_response");
  return result;
}
export async function getLink(
  signal: AbortSignal,
  id: string,
): Promise<LinkCard> {
  const card = await request(`/api/links/${encodeURIComponent(id)}`, signal);
  if (!isCard(card)) throw new Error("invalid_response");
  return card;
}
