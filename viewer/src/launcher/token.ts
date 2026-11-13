/**
 * The launcher's session token. `schemamap ui` puts it in the launch URL's fragment (`#t=…`),
 * which browsers never send to a server. The page keeps it in sessionStorage and removes it
 * from the address bar at once (docs/UI.md).
 */

export const TOKEN_KEY = "schemamap.token";

/** The part of `window.location` the token needs. */
export interface TokenLocation {
  readonly hash: string;
  readonly pathname: string;
  readonly search: string;
}

/** The token in a fragment such as `#t=abc`, or null when there is none. */
export function fragmentToken(hash: string): string | null {
  const token = new URLSearchParams(hash.replace(/^#/, "")).get("t");
  return token === null || token === "" ? null : token;
}

/**
 * Move the token from the fragment to `storage` and strip the fragment from the address bar.
 * Returns the token from the fragment, else the one stored by an earlier load (a reload), else
 * null. Storage that throws (blocked site data) only costs the reload case.
 */
export function takeToken(
  location: TokenLocation,
  storage: Pick<Storage, "getItem" | "setItem">,
  history: Pick<History, "replaceState">,
): string | null {
  const fromUrl = fragmentToken(location.hash);
  if (location.hash !== "") {
    history.replaceState(null, "", location.pathname + location.search);
  }
  if (fromUrl !== null) {
    try {
      storage.setItem(TOKEN_KEY, fromUrl);
    } catch {
      // Kept in memory for this load only.
    }
    return fromUrl;
  }
  try {
    return storage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
