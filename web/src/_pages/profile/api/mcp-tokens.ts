export interface MCPToken {
  id: string;
  created_at: string;
}
export interface CreatedMCPToken extends MCPToken {
  token: string;
}

export async function profileRequest<T>(
  path: string,
  method = "GET",
): Promise<T> {
  const response = await fetch(path, {
    method,
    cache: "no-store",
    credentials: "same-origin",
  });
  if (response.status === 401) throw new Error("unauthorized");
  if (!response.ok) throw new Error("request_failed");
  return response.status === 204 ? (undefined as T) : response.json();
}
export const tokenPath = "/api/users/me/mcp-tokens";
