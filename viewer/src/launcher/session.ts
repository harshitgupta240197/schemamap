import { storedToken, storeToken, takeCode, type CodeLocation } from "./token";

/** How the page got on with starting a session. */
export type Session =
  | { readonly kind: "ready"; readonly token: string }
  | { readonly kind: "no-link" }
  | { readonly kind: "code-refused" }
  | { readonly kind: "error"; readonly status: number }
  | { readonly kind: "unreachable" };

function tokenOf(body: unknown): string | null {
  if (typeof body === "object" && body !== null && "token" in body) {
    const { token } = body;
    return typeof token === "string" && token !== "" ? token : null;
  }
  return null;
}

/**
 * Start the page's session. A launch code in the fragment is removed from the address bar and
 * posted once to `/api/session`; the token in the answer is kept in sessionStorage. With no
 * code, the token an earlier load of this tab kept is used (a reload).
 */
export async function startSession(
  location: CodeLocation,
  storage: Pick<Storage, "getItem" | "setItem">,
  history: Pick<History, "replaceState">,
  fetcher: typeof fetch = fetch,
): Promise<Session> {
  const code = takeCode(location, history);
  if (code === null) {
    const token = storedToken(storage);
    return token === null ? { kind: "no-link" } : { kind: "ready", token };
  }
  try {
    const response = await fetcher("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
    if (response.status === 401) return { kind: "code-refused" };
    if (!response.ok) return { kind: "error", status: response.status };
    const token = tokenOf(await response.json());
    if (token === null) return { kind: "error", status: response.status };
    storeToken(storage, token);
    return { kind: "ready", token };
  } catch {
    return { kind: "unreachable" };
  }
}
