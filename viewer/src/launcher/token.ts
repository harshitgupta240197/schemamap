/**
 * The launch link and the session token. `schemamap ui` prints a link whose fragment holds a
 * one-time launch code (`#c=…`); fragments are never sent to a server. The page removes the code
 * from the address bar at once and trades it for the session token with `POST /api/session`.
 * The token then lives in sessionStorage only, never in a URL (docs/UI.md, D-060).
 */

export const TOKEN_KEY = "schemamap.token";

/** The part of `window.location` the launch code needs. */
export interface CodeLocation {
  readonly hash: string;
  readonly pathname: string;
  readonly search: string;
}

/** The code in a fragment such as `#c=abc`, or null when there is none. */
export function fragmentCode(hash: string): string | null {
  const code = new URLSearchParams(hash.replace(/^#/, "")).get("c");
  return code === null || code === "" ? null : code;
}

/**
 * The launch code in the fragment, with the fragment removed from the address bar and replaced
 * in history, so neither the code nor a way back to it stays. Null when there is no code.
 */
export function takeCode(
  location: CodeLocation,
  history: Pick<History, "replaceState">,
): string | null {
  const code = fragmentCode(location.hash);
  if (location.hash !== "") {
    history.replaceState(null, "", location.pathname + location.search);
  }
  return code;
}

/** The token kept by an earlier load of this tab (a reload), or null. */
export function storedToken(storage: Pick<Storage, "getItem">): string | null {
  try {
    return storage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

/** Keep the token for reloads of this tab. Blocked storage only costs the reload case. */
export function storeToken(storage: Pick<Storage, "setItem">, token: string): void {
  try {
    storage.setItem(TOKEN_KEY, token);
  } catch {
    // Kept in memory for this load only.
  }
}
