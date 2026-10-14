export interface LinkCard {
  id: string;
  submitted_url: string;
  title: string | null;
  state: "processing" | "ready" | "unavailable" | "failed";
  generation: number;
  created_at: string;
  requested_at: string;
  deadline_at: string;
}
export interface Draft {
  id: string;
  url: string;
  state: "sending" | "invalid" | "error";
}
export function validURL(raw: string) {
  try {
    const value = raw.trim();
    const url = new URL(value);
    return (
      /^https?:\/\//i.test(value) &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !/[\\\s]/u.test(value) &&
      value.length <= 65536
    );
  } catch {
    return false;
  }
}
export function mergeCards(current: LinkCard[], incoming: LinkCard[]) {
  const byID = new Map(current.map((card) => [card.id, card]));
  incoming.forEach((card) => byID.set(card.id, card));
  return [...byID.values()].sort(
    (a, b) =>
      b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id),
  );
}
