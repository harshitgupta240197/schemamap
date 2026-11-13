/** Calls to the launcher's own API. Every call carries the session token as a header. */

import type { Session } from "./session";

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

const RELAUNCH = "Run schemamap ui again and open the link it prints.";

/** What the launcher says after its health check. Plain text only. */
export async function healthMessage(token: string, fetcher: typeof fetch = fetch): Promise<string> {
  try {
    const response = await apiGet("/api/health", token, fetcher);
    if (response.ok) return "Connected to Schema Map";
    if (response.status === 401) return `This session has ended. ${RELAUNCH}`;
    return `Schema Map answered with an error (${String(response.status)}). ${RELAUNCH}`;
  } catch {
    return `Schema Map is not answering. Is schemamap ui still running? ${RELAUNCH}`;
  }
}

/** What the page says once it has tried to start a session. Plain text only. */
export function connectMessage(session: Session, fetcher: typeof fetch = fetch): Promise<string> {
  switch (session.kind) {
    case "ready":
      return healthMessage(session.token, fetcher);
    case "no-link":
      return Promise.resolve(`This page needs the link printed by schemamap ui. ${RELAUNCH}`);
    case "code-refused":
      return Promise.resolve(
        `This link has already been used or has expired. A link works once, for 60 seconds. ${RELAUNCH}`,
      );
    case "error":
      return Promise.resolve(
        `Schema Map answered with an error (${String(session.status)}). ${RELAUNCH}`,
      );
    case "unreachable":
      return Promise.resolve(
        `Schema Map is not answering. Is schemamap ui still running? ${RELAUNCH}`,
      );
  }
}
