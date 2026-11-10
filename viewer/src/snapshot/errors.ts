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
