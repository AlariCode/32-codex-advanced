import type { UserDTO } from "@/shared/api";
import { validURL, type LinkCard } from "../model/library";

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
  body?: { url: string } | { generation: number },
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
    validURL(value.submitted_url) &&
    typeof value.created_at === "string" &&
    Number.isInteger(value.generation) &&
    value.generation > 0 &&
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
): Promise<{ links: LinkCard[]; next_cursor: string; server_time: string }> {
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
): Promise<{ link: LinkCard; created: boolean; server_time: string }> {
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

export async function statuses(
  signal: AbortSignal,
  ids?: string[],
  cursor = "",
): Promise<{ links: LinkCard[]; next_cursor: string; server_time: string }> {
  const query = ids
    ? `ids=${encodeURIComponent(ids.join(","))}`
    : `limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
  const page = await request(`/api/links/statuses?${query}`, signal);
  if (
    !Array.isArray(page.links) ||
    !page.links.every(isCard) ||
    typeof page.next_cursor !== "string" ||
    typeof page.server_time !== "string"
  )
    throw new Error("invalid_response");
  return page;
}

export async function retryLink(
  signal: AbortSignal,
  id: string,
  generation: number,
): Promise<{ link: LinkCard; server_time: string }> {
  const result = await request(
    `/api/links/${encodeURIComponent(id)}/retry`,
    signal,
    { generation },
  );
  if (!isCard(result.link) || typeof result.server_time !== "string")
    throw new Error("invalid_response");
  return result;
}
