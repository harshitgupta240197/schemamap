/** Calls to the launcher's own API. Every call carries the session token as a header. */

export const TOKEN_HEADER = "X-SchemaMap-Token";

/** GET `path` on the launcher with the token header; never sends cookies or a Referer. */
export function apiGet(
  path: string,
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Response> {
  return fetcher(path, {
    headers: { [TOKEN_HEADER]: token },
    cache: "no-store",
    credentials: "omit",
    referrerPolicy: "no-referrer",
  });
}

/** What the launcher says after its health check. Plain text only. */
export async function healthMessage(
  token: string | null,
  fetcher: typeof fetch = fetch,
): Promise<string> {
  const relaunch = "Run schemamap ui again and open the link it prints.";
  if (token === null) return `This page needs the link printed by schemamap ui. ${relaunch}`;
  try {
    const response = await apiGet("/api/health", token, fetcher);
    if (response.ok) return "Connected to Schema Map";
    if (response.status === 401) return `This link has expired. ${relaunch}`;
    return `Schema Map answered with an error (${String(response.status)}). ${relaunch}`;
  } catch {
    return `Schema Map is not answering. Is schemamap ui still running? ${relaunch}`;
  }
}
