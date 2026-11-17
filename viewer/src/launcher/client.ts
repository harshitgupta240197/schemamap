/** Typed calls to the launcher API. Every function returns a value; none throws. */

import { TOKEN_HEADER } from "./api";
import type { ConnectionBody } from "./form";
import {
  parseCapabilities,
  parseDatabases,
  parseFailure,
  parseImported,
  parseJobStarted,
  parseJobStatus,
  parseFolder,
  parseMaps,
  parseQueries,
  parseRemembered,
  parseTestResult,
  type Capabilities,
  type Failure,
  type JobStatus,
  type MapEntry,
  type QueryCatalog,
  type RememberedConnection,
  type TestResult,
} from "./model";

export type Outcome<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: Failure };

const UNREACHABLE: Failure = {
  status: 0,
  message: "Schema Map is not answering.",
  fix: "Check that schemamap ui is still running. If it stopped, run it again and open the new link.",
};

const UNEXPECTED: Failure = {
  status: 0,
  message: "Schema Map sent an answer this page does not understand.",
  fix: "Run schemamap ui again. If it keeps happening, the page and the command may be different versions.",
};

async function call<T>(
  method: "GET" | "POST" | "DELETE",
  path: string,
  token: string,
  body: unknown,
  read: (json: unknown) => T | null,
  fetcher: typeof fetch,
): Promise<Outcome<T>> {
  let response: Response;
  try {
    response = await fetcher(path, {
      method,
      headers: {
        [TOKEN_HEADER]: token,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return { ok: false, failure: UNREACHABLE };
  }
  const json: unknown = await response.json().catch((): unknown => null);
  if (!response.ok) return { ok: false, failure: parseFailure(response.status, json) };
  const value = read(json);
  return value === null ? { ok: false, failure: UNEXPECTED } : { ok: true, value };
}

export function fetchCapabilities(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<Capabilities>> {
  return call("GET", "/api/capabilities", token, undefined, parseCapabilities, fetcher);
}

export function fetchRemembered(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<RememberedConnection[]>> {
  return call("GET", "/api/connections", token, undefined, parseRemembered, fetcher);
}

export function forgetConnection(
  token: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<true>> {
  return call(
    "DELETE",
    `/api/connections/${encodeURIComponent(id)}`,
    token,
    undefined,
    () => true as const,
    fetcher,
  );
}

export function testConnection(
  token: string,
  connection: ConnectionBody,
  remember: boolean,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<TestResult>> {
  return call(
    "POST",
    "/api/connection/test",
    token,
    { connection, remember },
    parseTestResult,
    fetcher,
  );
}

export function listDatabases(
  token: string,
  connection: ConnectionBody,
  includeSystem: boolean,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<string[]>> {
  return call(
    "POST",
    "/api/databases",
    token,
    { connection, include_system: includeSystem },
    parseDatabases,
    fetcher,
  );
}

/** Start an extract job. The body is the only place the password goes, and it is not kept. */
export function startJob(
  token: string,
  connection: ConnectionBody,
  remember: boolean,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<string>> {
  return call("POST", "/api/jobs", token, { connection, remember }, parseJobStarted, fetcher);
}

export function fetchJob(
  token: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<JobStatus>> {
  return call(
    "GET",
    `/api/jobs/${encodeURIComponent(id)}`,
    token,
    undefined,
    parseJobStatus,
    fetcher,
  );
}

export function cancelJob(
  token: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<true>> {
  return call(
    "POST",
    `/api/jobs/${encodeURIComponent(id)}/cancel`,
    token,
    {},
    () => true as const,
    fetcher,
  );
}

export function fetchMaps(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<MapEntry[]>> {
  return call("GET", "/api/maps", token, undefined, parseMaps, fetcher);
}

/** Every query this version can send, as the .sql files it ships with. */
export function fetchQueries(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<QueryCatalog>> {
  return call("GET", "/api/queries", token, undefined, parseQueries, fetcher);
}

/** The folder maps are kept in, for display. */
export function fetchMapsFolder(
  token: string,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<string>> {
  return call("GET", "/api/maps/folder", token, undefined, parseFolder, fetcher);
}

export function deleteMap(
  token: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<true>> {
  return call(
    "DELETE",
    `/api/maps/${encodeURIComponent(id)}`,
    token,
    undefined,
    () => true as const,
    fetcher,
  );
}

/** Stop the local server. The answer may never arrive if the server closes first. */
export function quitServer(token: string, fetcher: typeof fetch = fetch): Promise<Outcome<true>> {
  return call("POST", "/api/quit", token, {}, () => true as const, fetcher);
}

/** Gzip files start with these two bytes; the server wants the type named in the request. */
export async function isGzip(file: Blob): Promise<boolean> {
  const head = new Uint8Array(await file.slice(0, 2).arrayBuffer());
  return head[0] === 0x1f && head[1] === 0x8b;
}

/** Upload a snapshot file (`.json` or `.json.gz`) and make a map from it. */
export async function importMap(
  token: string,
  file: Blob,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<string>> {
  const gzip = await isGzip(file);
  let response: Response;
  try {
    response = await fetcher("/api/maps/import", {
      method: "POST",
      headers: {
        [TOKEN_HEADER]: token,
        "Content-Type": gzip ? "application/gzip" : "application/json",
      },
      body: file,
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return { ok: false, failure: UNREACHABLE };
  }
  const json: unknown = await response.json().catch((): unknown => null);
  if (!response.ok) return { ok: false, failure: parseFailure(response.status, json) };
  const id = parseImported(json);
  return id === null ? { ok: false, failure: UNEXPECTED } : { ok: true, value: id };
}

/** The map file's bytes and the name the server gave it. The route needs the token, so a link cannot do it. */
export async function downloadMap(
  token: string,
  id: string,
  fetcher: typeof fetch = fetch,
): Promise<Outcome<{ readonly blob: Blob; readonly name: string }>> {
  let response: Response;
  try {
    response = await fetcher(`/api/maps/${encodeURIComponent(id)}/download`, {
      headers: { [TOKEN_HEADER]: token },
      cache: "no-store",
      credentials: "omit",
      referrerPolicy: "no-referrer",
    });
  } catch {
    return { ok: false, failure: UNREACHABLE };
  }
  if (!response.ok) {
    const json: unknown = await response.json().catch((): unknown => null);
    return { ok: false, failure: parseFailure(response.status, json) };
  }
  const named = /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "");
  return { ok: true, value: { blob: await response.blob(), name: named?.[1] ?? "map.html" } };
}
