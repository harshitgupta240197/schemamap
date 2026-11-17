/** Plain helpers for the extract and recent-maps screens: wording, formatting, the re-run target. */

import { applyRemembered, type FormState, usable } from "./form";
import type {
  Capabilities,
  JobStatus,
  MapEntry,
  RememberedConnection,
  SectionStatus,
} from "./model";

const TITLES: Readonly<Record<string, string>> = {
  schemas: "Schemas",
  tables: "Tables",
  views: "Views",
  routines: "Procedures and functions",
  synonyms: "Synonyms",
  relationships: "Relationships",
  dependencies: "Dependencies",
  row_counts: "Row counts",
};

const NOUNS: Readonly<Record<string, readonly [string, string]>> = {
  schemas: ["schema", "schemas"],
  tables: ["table", "tables"],
  views: ["view", "views"],
  routines: ["routine", "routines"],
  synonyms: ["synonym", "synonyms"],
  relationships: ["relationship", "relationships"],
  dependencies: ["dependency", "dependencies"],
  row_counts: ["row count", "row counts"],
};

/** A section's name as the page shows it. An unknown name is shown as the server sent it. */
export function sectionTitle(name: string): string {
  return TITLES[name] ?? name;
}

/** "71 tables", or null for a section that has no count (yet). */
export function sectionCount(section: SectionStatus): string | null {
  if (section.count === null) return null;
  const noun = NOUNS[section.name];
  const number = section.count.toLocaleString("en-US");
  if (noun === undefined) return number;
  return `${number} ${section.count === 1 ? noun[0] : noun[1]}`;
}

/** How many sections are finished (done or skipped) and how many there are. */
export function sectionProgress(job: JobStatus): {
  readonly finished: number;
  readonly total: number;
} {
  const finished = job.sections.filter(
    (section) => section.state === "done" || section.state === "skipped",
  ).length;
  return { finished, total: job.sections.length };
}

/** The section a failed job stopped at, when the server marked one. */
export function failedSection(job: JobStatus): SectionStatus | null {
  return job.sections.find((section) => section.state === "failed") ?? null;
}

/** 62 s → "1:02". */
export function formatElapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** 2 516 582 bytes → "2.4 MB". */
export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function clock(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function sameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "Today, 12:41", "Yesterday, 18:05" or "12 Nov 2026", in this computer's time zone. */
export function formatExtracted(iso: string, now: Date = new Date()): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown";
  if (sameDay(date, now)) return `Today, ${clock(date)}`;
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  if (sameDay(date, yesterday)) return `Yesterday, ${clock(date)}`;
  return `${String(date.getDate())} ${MONTHS[date.getMonth()] ?? ""} ${String(date.getFullYear())}`;
}

/**
 * The connection settings to re-run a map with, minus the password: the form when it is for the
 * same server, else a remembered connection for it. Null when neither is known; the page then
 * sends the person to Connect. Timeouts and certificate trust always come from the form.
 */
export function rerunTarget(
  map: MapEntry,
  form: FormState,
  remembered: readonly RememberedConnection[],
  caps: Capabilities,
): FormState | null {
  if (map.server === null) return null;
  const same = (server: string) => server.trim().toLowerCase() === map.server?.toLowerCase();
  if (same(form.server)) return { ...form, password: "" };
  const entry = usable(remembered, caps).find((item) => same(item.server));
  return entry === undefined ? null : applyRemembered(form, entry, caps);
}

/** The queries each progress section reads, for the failure screens' technical details. */
const SECTION_QUERIES: Readonly<Record<string, string>> = {
  schemas: "schemas",
  tables: "tables, columns, indexes, index_columns, check_constraints",
  views: "views, view_columns",
  routines: "routines",
  synonyms: "synonyms",
  relationships: "foreign_keys",
  dependencies: "dependencies",
  row_counts: "row_counts",
};

/** The query names behind a section; the section's own name when it is not one we know. */
export function sectionQueries(name: string): string {
  return SECTION_QUERIES[name] ?? name;
}

/** The short code a failure carries, for display: the server's code, else what the status says. */
export function failureCategory(failure: { status: number; code?: string }): string {
  if (failure.code !== undefined) return failure.code;
  return failure.status === 0 ? "unreachable" : `http_${String(failure.status)}`;
}
