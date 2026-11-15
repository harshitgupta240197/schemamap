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

export type JobState = "running" | "done" | "failed" | "cancelled";
export type SectionState = "pending" | "running" | "done" | "skipped" | "failed";

export interface SectionStatus {
  readonly name: string;
  readonly state: SectionState;
  /** Items read; the server fills it in only once the job has ended in `done` (D-063). */
  readonly count: number | null;
}

/** Why a job failed: fixed wording from the server, never a submitted value. */
export interface JobError {
  readonly code: string;
  readonly message: string;
  readonly fix: string | null;
}

export interface JobStatus {
  readonly id: string;
  readonly state: JobState;
  readonly sections: readonly SectionStatus[];
  readonly elapsedMs: number;
  readonly mapId: string | null;
  readonly error: JobError | null;
}

/** One saved map, as the maps list sends it. */
export interface MapEntry {
  readonly id: string;
  readonly database: string;
  readonly server: string | null;
  readonly extractedAt: string;
  readonly tables: number;
  readonly bytes: number;
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

/** `POST /api/jobs`: the new job's id. */
export function parseJobStarted(body: unknown): string | null {
  return isObj(body) ? str(body.job_id) : null;
}

const JOB_STATES: readonly string[] = ["running", "done", "failed", "cancelled"];
const SECTION_STATES: readonly string[] = ["pending", "running", "done", "skipped", "failed"];

function sectionStatus(value: unknown): SectionStatus | null {
  if (!isObj(value)) return null;
  const { name, state, count } = value;
  if (typeof name !== "string" || typeof state !== "string") return null;
  if (!SECTION_STATES.includes(state)) return null;
  return {
    name,
    state: state as SectionState,
    count: typeof count === "number" ? count : null,
  };
}

/** `GET /api/jobs/<id>`. */
export function parseJobStatus(body: unknown): JobStatus | null {
  if (!isObj(body)) return null;
  const { job_id: id, state, elapsed_ms: elapsed, map_id: mapId, error } = body;
  if (typeof id !== "string" || typeof state !== "string" || !JOB_STATES.includes(state)) {
    return null;
  }
  const sections = list(body.sections).flatMap((entry) => sectionStatus(entry) ?? []);
  const failure =
    isObj(error) && typeof error.message === "string"
      ? { code: str(error.code) ?? "failed", message: error.message, fix: str(error.fix) }
      : null;
  return {
    id,
    state: state as JobState,
    sections,
    elapsedMs: typeof elapsed === "number" ? elapsed : 0,
    mapId: str(mapId),
    error: failure,
  };
}

function mapEntry(value: unknown): MapEntry | null {
  if (!isObj(value)) return null;
  const { id, database, server, extracted_at: extractedAt, tables, bytes } = value;
  if (typeof id !== "string" || typeof database !== "string") return null;
  if (typeof extractedAt !== "string" || typeof tables !== "number" || typeof bytes !== "number") {
    return null;
  }
  return { id, database, server: str(server), extractedAt, tables, bytes };
}

/** `GET /api/maps`: the maps in the order the server sent them (newest first). */
export function parseMaps(body: unknown): MapEntry[] | null {
  if (!isObj(body) || !Array.isArray(body.maps)) return null;
  return list(body.maps).flatMap((entry) => mapEntry(entry) ?? []);
}

/** `POST /api/maps/import`: the id of the new map. */
export function parseImported(body: unknown): string | null {
  return isObj(body) ? str(body.map_id) : null;
}
