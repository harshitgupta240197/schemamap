/** The launcher API's answers, checked as they come in: nothing is trusted to have the right shape. */

export type AuthGroup = "sql" | "windows" | "entra";
export type CheckStatus = "ok" | "warn" | "fail";
/** What a check judges: the server and sign-in, or the chosen database's permissions. */
export type CheckScope = "server" | "database";

export interface AuthModeInfo {
  readonly id: string;
  readonly group: AuthGroup;
  readonly label: string;
  readonly needsUser: boolean;
  readonly needsPassword: boolean;
}

export interface Capabilities {
  readonly os: "windows" | "macos" | "linux";
  readonly authModes: readonly AuthModeInfo[];
}

export interface RememberedConnection {
  readonly id: string;
  readonly server: string;
  readonly port: number;
  readonly auth: string;
  readonly user: string | null;
}

export interface CheckResult {
  readonly name: string;
  readonly status: CheckStatus;
  readonly scope: CheckScope;
  readonly message: string;
  readonly fix: string | null;
  readonly fixSql: string | null;
}

export interface TestResult {
  readonly checks: readonly CheckResult[];
  readonly connected: boolean;
}

/** An error answer from the server: what went wrong and, often, what to do about it. */
export interface Failure {
  readonly status: number;
  readonly message: string;
  readonly fix: string | null;
}

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? (value as unknown[]) : [];
}

function authMode(value: unknown): AuthModeInfo | null {
  if (!isObj(value)) return null;
  const { id, group, label, needs_user: needsUser, needs_password: needsPassword } = value;
  if (typeof id !== "string" || typeof label !== "string") return null;
  if (group !== "sql" && group !== "windows" && group !== "entra") return null;
  return { id, group, label, needsUser: needsUser === true, needsPassword: needsPassword === true };
}

/** `GET /api/capabilities`, or null when the answer is not what the page needs. */
export function parseCapabilities(body: unknown): Capabilities | null {
  if (!isObj(body)) return null;
  const { os } = body;
  if (os !== "windows" && os !== "macos" && os !== "linux") return null;
  const authModes = list(body.auth_modes).flatMap((entry) => authMode(entry) ?? []);
  return authModes.length === 0 ? null : { os, authModes };
}

/** `GET /api/connections`: entries the page can use; malformed ones are dropped. */
export function parseRemembered(body: unknown): RememberedConnection[] {
  if (!isObj(body)) return [];
  return list(body.connections).flatMap((entry): RememberedConnection[] => {
    if (!isObj(entry)) return [];
    const { id, server, port, auth, user } = entry;
    if (typeof id !== "string" || typeof server !== "string" || typeof auth !== "string") return [];
    if (typeof port !== "number") return [];
    return [{ id, server, port, auth, user: str(user) }];
  });
}

const STATUS_ORDER: Record<CheckStatus, number> = { fail: 0, warn: 1, ok: 2 };

function checkResult(value: unknown): CheckResult | null {
  if (!isObj(value)) return null;
  const { name, status, scope, message, fix, fix_sql: fixSql } = value;
  if (typeof name !== "string") return null;
  if (status !== "ok" && status !== "warn" && status !== "fail") return null;
  return {
    name,
    status,
    scope: scope === "database" ? "database" : "server",
    message: str(message) ?? name,
    fix: str(fix),
    fixSql: str(fixSql),
  };
}

/** `POST /api/connection/test`, with the checks ordered fail, warn, pass (stable inside each). */
export function parseTestResult(body: unknown): TestResult | null {
  if (!isObj(body)) return null;
  const checks = list(body.checks).flatMap((entry) => checkResult(entry) ?? []);
  if (checks.length === 0) return null;
  const ordered = checks
    .map((check, index) => ({ check, index }))
    .sort(
      (a, b) => STATUS_ORDER[a.check.status] - STATUS_ORDER[b.check.status] || a.index - b.index,
    )
    .map(({ check }) => check);
  return { checks: ordered, connected: body.connected === true };
}

/** `POST /api/databases`: the names, in the order the server sent them. */
export function parseDatabases(body: unknown): string[] | null {
  if (!isObj(body) || !Array.isArray(body.databases)) return null;
  return list(body.databases).flatMap((entry) =>
    isObj(entry) && typeof entry.name === "string" ? [entry.name] : [],
  );
}

/** The `{ error: { message, fix } }` answer, or a fixed sentence when the body is something else. */
export function parseFailure(status: number, body: unknown): Failure {
  const error = isObj(body) ? body.error : undefined;
  if (isObj(error) && typeof error.message === "string") {
    return { status, message: error.message, fix: str(error.fix) };
  }
  return { status, message: `Schema Map answered with an error (${String(status)}).`, fix: null };
}
