/** Typed calls to the launcher API. Every function returns a value; none throws. */

import { TOKEN_HEADER } from "./api";
import type { ConnectionBody } from "./form";
import {
  parseCapabilities,
  parseDatabases,
  parseFailure,
  parseRemembered,
  parseTestResult,
  type Capabilities,
  type Failure,
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
