/** Why a snapshot could not be loaded. Each kind has its own screen and message. */
export type SnapshotLoadErrorKind =
  | "no_data"
  | "unreadable_file"
  | "invalid_json"
  | "missing_version"
  | "unsupported_version"
  | "schema_violation";

/** A snapshot could not be loaded. `details` holds extra lines, such as violation paths. */
export class SnapshotLoadError extends Error {
  readonly kind: SnapshotLoadErrorKind;
  readonly details: readonly string[];

  constructor(kind: SnapshotLoadErrorKind, message: string, details: readonly string[] = []) {
    super(message);
    this.name = "SnapshotLoadError";
    this.kind = kind;
    this.details = details;
  }
}

const PLAIN: Record<SnapshotLoadErrorKind, string> = {
  no_data: "There is no snapshot in this page.",
  unreadable_file: "That file could not be read.",
  invalid_json: "That file is not a snapshot: it is not valid JSON.",
  missing_version: "That file does not look like a Schema Map snapshot.",
  unsupported_version: "That snapshot was made by a different version of Schema Map.",
  schema_violation: "That snapshot is incomplete or damaged, so it cannot be shown.",
};

/** A plain-English sentence for the person looking at the screen; the technical text is for Details. */
export function plainMessage(kind: SnapshotLoadErrorKind): string {
  return PLAIN[kind];
}
