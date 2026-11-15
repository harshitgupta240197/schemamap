import type { AuthGroup, AuthModeInfo, Capabilities, RememberedConnection } from "./model";

/** What the Connect form holds. Strings stay strings until validation. */
export interface FormState {
  readonly server: string;
  readonly port: string;
  readonly group: AuthGroup;
  /** The Entra method, an id from the server's list. */
  readonly entraMode: string;
  readonly user: string;
  readonly password: string;
  readonly trust: boolean;
  readonly remember: boolean;
  readonly connectTimeout: string;
  readonly queryTimeout: string;
}

export type FormErrors = Partial<
  Record<"server" | "port" | "user" | "password" | "connectTimeout" | "queryTimeout", string>
>;

/** The body of a `connection` object in a request. */
export interface ConnectionBody {
  readonly server: string;
  readonly port: number;
  readonly database: string;
  readonly auth: string;
  readonly user?: string;
  readonly password?: string;
  readonly trust_server_certificate: boolean;
  readonly connect_timeout: number;
  readonly query_timeout: number;
}

export const GROUP_LABELS: Record<AuthGroup, string> = {
  sql: "SQL Server login",
  windows: "Windows",
  entra: "Microsoft Entra ID",
};

/** The database every login can open, used until the person picks one. */
export const DEFAULT_DATABASE = "master";

/** The sign-in groups this machine offers, in display order. Windows needs a Windows server list entry. */
export function offeredGroups(caps: Capabilities): AuthGroup[] {
  const present = new Set(caps.authModes.map((mode) => mode.group));
  return (["sql", "windows", "entra"] as const).filter(
    (group) => present.has(group) && (group !== "windows" || caps.os === "windows"),
  );
}

export function entraModes(caps: Capabilities): AuthModeInfo[] {
  return caps.authModes.filter((mode) => mode.group === "entra");
}

/** A new form: SQL Server login first, certificate trust off, the documented timeouts. */
export function initialForm(caps: Capabilities): FormState {
  const groups = offeredGroups(caps);
  return {
    server: "",
    port: "1433",
    group: groups[0] ?? "sql",
    entraMode: entraModes(caps)[0]?.id ?? "",
    user: "",
    password: "",
    trust: false,
    remember: false,
    connectTimeout: "15",
    queryTimeout: "60",
  };
}

/** The mode the form means: the Entra method for the Entra group, else the group's one mode. */
export function selectedMode(form: FormState, caps: Capabilities): AuthModeInfo | undefined {
  const id = form.group === "entra" ? form.entraMode : form.group;
  return caps.authModes.find((mode) => mode.id === id);
}

function whole(text: string, low: number, high: number): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return value >= low && value <= high ? value : null;
}

/** Field errors, in plain words. Empty when the form can be sent. */
export function validate(form: FormState, caps: Capabilities): FormErrors {
  const errors: Record<string, string> = {};
  if (form.server.trim() === "") errors.server = "Enter the server name or address.";
  else if (form.server.length > 256) errors.server = "The server name is too long.";
  if (whole(form.port, 1, 65535) === null) errors.port = "Enter a port from 1 to 65535.";
  const mode = selectedMode(form, caps);
  if (mode?.needsUser === true && form.user.trim() === "") errors.user = "Enter the user name.";
  if (mode?.needsPassword === true && form.password === "") errors.password = "Enter the password.";
  if (whole(form.connectTimeout, 1, 300) === null) {
    errors.connectTimeout = "Enter a whole number of seconds from 1 to 300.";
  }
  if (whole(form.queryTimeout, 1, 300) === null) {
    errors.queryTimeout = "Enter a whole number of seconds from 1 to 300.";
  }
  return errors;
}

/** The request body for a form that passed `validate`; null if it did not. */
export function toConnection(
  form: FormState,
  caps: Capabilities,
  database: string = DEFAULT_DATABASE,
): ConnectionBody | null {
  const mode = selectedMode(form, caps);
  const port = whole(form.port, 1, 65535);
  const connect = whole(form.connectTimeout, 1, 300);
  const query = whole(form.queryTimeout, 1, 300);
  if (mode === undefined || port === null || connect === null || query === null) return null;
  const user = form.user.trim();
  return {
    server: form.server.trim(),
    port,
    database,
    auth: mode.id,
    ...(mode.needsUser || user !== "" ? { user } : {}),
    ...(mode.needsPassword ? { password: form.password } : {}),
    trust_server_certificate: form.trust,
    connect_timeout: connect,
    query_timeout: query,
  };
}

/** What `Use` fills in from a remembered connection. The password is never among it. */
export function applyRemembered(
  form: FormState,
  entry: RememberedConnection,
  caps: Capabilities,
): FormState {
  const mode = caps.authModes.find((candidate) => candidate.id === entry.auth);
  return {
    ...form,
    server: entry.server,
    port: String(entry.port),
    group: mode?.group ?? form.group,
    entraMode: mode?.group === "entra" ? mode.id : form.entraMode,
    user: entry.user ?? "",
    password: "",
    remember: true,
  };
}

/** Remembered connections this machine can use again: a Windows one is hidden elsewhere. */
export function usable(
  entries: readonly RememberedConnection[],
  caps: Capabilities,
): RememberedConnection[] {
  return entries.filter((entry) => {
    const mode = caps.authModes.find((candidate) => candidate.id === entry.auth);
    return mode !== undefined && (mode.group !== "windows" || caps.os === "windows");
  });
}

/** How a remembered connection says how it signs in: "SQL Server login" or the Entra method. */
export function authLabel(entry: RememberedConnection, caps: Capabilities): string {
  const mode = caps.authModes.find((candidate) => candidate.id === entry.auth);
  if (mode === undefined) return entry.auth;
  return mode.group === "entra"
    ? `Entra ID · ${mode.label.split(" (")[0] ?? mode.label}`
    : GROUP_LABELS[mode.group];
}

/** The `server, port` line used for a connection in headings and recent lists. */
export function endpointLabel(server: string, port: number | string): string {
  return `${server}, ${String(port)}`;
}
