export { usePrivateHistory } from "./private-history";
import type { UserDTO } from "@/shared/api";

export function safeReturnTo(value: string | null): string {
  if (!value || /[\\\s%]/u.test(value)) return "/";
  // Only implemented private routes are valid destinations.
  return value === "/" || /^\/links\/[a-zA-Z0-9-]+$/.test(value) ? value : "/";
}
export function loginPath() {
  return `/login?returnTo=${encodeURIComponent(safeReturnTo(window.location.pathname))}`;
}
export class SessionError extends Error {
  constructor(public status: number) {
    super("session_error");
  }
}
export async function verifySession(signal: AbortSignal): Promise<UserDTO> {
  const response = await fetch("/api/users/me", {
    signal,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (!response.ok) throw new SessionError(response.status);
  const user = await response.json();
  if (!user || typeof user.id !== "string" || typeof user.email !== "string")
    throw new Error("invalid_session");
  return user;
}
export function isUnauthorized(error: unknown) {
  return error instanceof Error && "status" in error && error.status === 401;
}
// No credentials or private data are broadcast or persisted by session management.
export function resetSession() {
  window.dispatchEvent(new Event("linkbook:session-reset"));
}
export function subscribeSessionReset(reset: () => void) {
  window.addEventListener("linkbook:session-reset", reset);
  const channel =
    typeof BroadcastChannel === "undefined"
      ? null
      : new BroadcastChannel("linkbook-session");
  if (channel) channel.onmessage = reset;
  return () => {
    window.removeEventListener("linkbook:session-reset", reset);
    channel?.close();
  };
}
export function announceSessionChange() {
  resetSession();
  if (typeof BroadcastChannel !== "undefined") {
    const channel = new BroadcastChannel("linkbook-session");
    channel.postMessage("changed");
    channel.close();
  }
}
