import type { UserDTO } from "@/shared/api";

export type LoggedInUser = UserDTO;

export class LoginError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "LoginError";
  }
}

export async function loginUser(email: string, password: string): Promise<LoggedInUser> {
  let response: Response;
  let data: unknown;
  try {
    response = await fetch("/api/users/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      cache: "no-store",
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15_000),
    });
    data = await response.json().catch(() => null);
  } catch {
    throw new LoginError("network_error");
  }

  if (!response.ok) {
    const code = response.status === 401 ? "invalid_credentials"
      : data && typeof data === "object" && "code" in data && typeof data.code === "string"
        ? data.code : "internal_error";
    throw new LoginError(code);
  }
  if (response.status !== 200 || !data || typeof data !== "object" ||
    !("id" in data) || typeof data.id !== "string" || !data.id ||
    !("email" in data) || typeof data.email !== "string" || !data.email ||
    !("created_at" in data) || typeof data.created_at !== "string" || !Number.isFinite(Date.parse(data.created_at))) {
    throw new LoginError("internal_error");
  }
  return { id: data.id, email: data.email, created_at: data.created_at };
}
