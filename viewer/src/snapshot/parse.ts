import type { SchemaMapSnapshotV1 } from "../generated/snapshot";
import validate from "../generated/validate-snapshot.js";
import { SnapshotLoadError } from "./errors";

/** The snapshot major version this viewer reads. Any 1.x is accepted. */
export const SUPPORTED_MAJOR = 1;
export const SUPPORTED_VERSION_LABEL = `${String(SUPPORTED_MAJOR)}.x`;

/** How many schema violations are shown before "and N more". */
export const MAX_REPORTED_VIOLATIONS = 5;

const VERSION_PATTERN = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkVersion(doc: Record<string, unknown>): void {
  const found = doc["format_version"];
  if (found === undefined) {
    throw new SnapshotLoadError(
      "missing_version",
      `This file has no format_version, so it is not a Schema Map snapshot this viewer can read (supported: ${SUPPORTED_VERSION_LABEL}).`,
    );
  }
  const match = typeof found === "string" ? VERSION_PATTERN.exec(found) : null;
  if (match === null) {
    throw new SnapshotLoadError(
      "unsupported_version",
      `Unrecognised format_version ${JSON.stringify(found)}; supported: ${SUPPORTED_VERSION_LABEL}.`,
    );
  }
  if (Number(match[1]) !== SUPPORTED_MAJOR) {
    throw new SnapshotLoadError(
      "unsupported_version",
      `This snapshot is format version ${match[0]}; this viewer supports ${SUPPORTED_VERSION_LABEL}. Use a viewer that matches the snapshot.`,
    );
  }
}

function violations(): string[] {
  const seen = new Set<string>();
  for (const error of validate.errors ?? []) {
    const path = error.instancePath === "" ? "(root)" : error.instancePath;
    seen.add(`${path}: ${error.message ?? "is invalid"}`);
  }
  const all = [...seen];
  const shown = all.slice(0, MAX_REPORTED_VIOLATIONS);
  if (all.length > shown.length) {
    shown.push(`and ${String(all.length - shown.length)} more`);
  }
  return shown;
}

/**
 * Parse and validate snapshot JSON text.
 *
 * Order matters: the version is checked before the schema so a future major version
 * reports "unsupported version" rather than a wall of schema errors.
 * Throws {@link SnapshotLoadError}.
 */
export function parseSnapshot(text: string): SchemaMapSnapshotV1 {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown parse error";
    throw new SnapshotLoadError("invalid_json", `The file is not valid JSON: ${reason}`);
  }
  if (!isRecord(doc)) {
    throw new SnapshotLoadError(
      "schema_violation",
      "The file is JSON but not a Schema Map snapshot (expected an object).",
    );
  }
  checkVersion(doc);
  if (!validate(doc)) {
    throw new SnapshotLoadError(
      "schema_violation",
      "The snapshot does not match the Schema Map snapshot schema.",
      violations(),
    );
  }
  return doc as SchemaMapSnapshotV1;
}
