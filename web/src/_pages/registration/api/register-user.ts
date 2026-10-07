import type { UserDTO } from "@/shared/api";

export type RegisteredUser = UserDTO;

export class RegistrationError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "RegistrationError";
  }
}

export async function registerUser(email: string, password: string): Promise<RegisteredUser> {
  let response: Response;
  try {
    response = await fetch("/api/users/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    throw new RegistrationError("network_error");
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data && typeof data === "object" && "code" in data && typeof data.code === "string"
      ? data.code : "internal_error";
    throw new RegistrationError(code);
  }
  if (response.status !== 201 || !data || typeof data !== "object" ||
    !("id" in data) || typeof data.id !== "string" ||
    !("email" in data) || typeof data.email !== "string" ||
    !("created_at" in data) || typeof data.created_at !== "string") {
    throw new RegistrationError("internal_error");
  }
  return { id: data.id, email: data.email, created_at: data.created_at };
}
