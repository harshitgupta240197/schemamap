import type {
  Column1,
  DefinitionStatus,
  Dependency,
  ReferentialAction,
  Reference,
  RowCount,
  Table,
} from "../generated/snapshot";
import type { Entity, ObjectEntity, SnapshotIndexes } from "../snapshot/indexes";

/** Kinds of object the detail panel can show. */
export type SelectableKind = "table" | "view" | "routine";

/** A reference to another object: a link when it resolves to something on the map, else text. */
export type ObjectLink =
  | { readonly kind: "object"; readonly id: string; readonly label: string; readonly what: string }
  | { readonly kind: "text"; readonly label: string; readonly what: string };

export interface ColumnDetail {
  readonly id: string;
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  readonly identity: boolean;
  readonly computed: { readonly definition: string | null; readonly persisted: boolean } | null;
  readonly defaultText: string | null;
  readonly isPrimaryKey: boolean;
  readonly isUnique: boolean;
  readonly isForeignKey: boolean;
}

export interface IndexDetail {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly unique: boolean;
  readonly disabled: boolean;
  readonly keyColumns: readonly string[];
  readonly includedColumns: readonly string[];
  readonly filter: string | null;
}

export interface ForeignKeyDetail {
  readonly id: string;
  readonly name: string;
  readonly other: ObjectLink;
  /** `local -> remote` column names, in key order. */
  readonly columns: string;
  readonly onDelete: string;
  readonly onUpdate: string;
  readonly flags: readonly string[];
}

export interface DefinitionDetail {
  readonly status: DefinitionStatus;
  /** Plain-English account of the status. */
  readonly reason: string;
  readonly text: string | null;
}

export interface DetailModel {
  readonly id: string;
  readonly kind: SelectableKind;
  /** Routine kind in words ("Stored procedure"), else "Table" or "View". */
  readonly kindLabel: string;
  readonly schemaName: string;
  readonly name: string;
  readonly qualified: string;
  readonly description: string | null;
  /** For a trigger: the table or view it belongs to. */
  readonly parent: ObjectLink | null;
  readonly columns: readonly ColumnDetail[];
  readonly keyConstraints: readonly { name: string; kind: string; columns: string }[];
  readonly indexes: readonly IndexDetail[];
  readonly checks: readonly { name: string; flags: readonly string[] }[];
  /** Row count and size text for a table; "not available" when the snapshot has none. */
  readonly rows: string | null;
  readonly size: string | null;
  readonly outgoingKeys: readonly ForeignKeyDetail[];
  readonly incomingKeys: readonly ForeignKeyDetail[];
  /** Objects this one reads or calls. */
  readonly dependsOn: readonly ObjectLink[];
  /** Objects that read or call this one. */
  readonly usedBy: readonly ObjectLink[];
  readonly definition: DefinitionDetail | null;
}

const NOT_AVAILABLE = "not available";

const ROUTINE_LABEL: Readonly<Record<string, string>> = {
  procedure: "Stored procedure",
  scalar_function: "Scalar function",
  table_function: "Table function",
  inline_table_function: "Inline table function",
  trigger: "Trigger",
  other: "Routine",
};

const ACTION_LABEL: Readonly<Record<ReferentialAction, string>> = {
  no_action: "no action",
  cascade: "cascade",
  set_null: "set null",
  set_default: "set default",
};

const SCOPE_LABEL: Readonly<Record<Reference["scope"], string>> = {
  local: "Unresolved reference",
  cross_database: "Cross-database reference",
  cross_server: "Cross-server reference",
  column_method: "Column method",
};

const INDEX_KIND_LABEL: Readonly<Record<string, string>> = {
  clustered: "clustered",
  nonclustered: "nonclustered",
  clustered_columnstore: "clustered columnstore",
  nonclustered_columnstore: "nonclustered columnstore",
  xml: "XML",
  spatial: "spatial",
  hash: "hash",
  other: "other",
};

/** Why a definition is or is not shown, in words for the person looking at the map. */
export function definitionReason(status: DefinitionStatus, hasText: boolean): string {
  switch (status) {
    case "available":
      return hasText
        ? "The definition was read from the database."
        : "The database reported a definition, but no text was captured.";
    case "encrypted":
      return "The definition is encrypted (WITH ENCRYPTION), so SQL Server does not give out its text.";
    case "not_permitted":
      return "The login that made this snapshot is not allowed to read the definition (it needs VIEW DEFINITION).";
    case "not_applicable":
      return "This kind of object has no T-SQL definition to show.";
    case "omitted":
      return "The definition was left out of this snapshot on purpose.";
  }
}

const TYPES_WITH_LENGTH = new Set(["char", "varchar", "nchar", "nvarchar", "binary", "varbinary"]);
const TYPES_WITH_SCALE = new Set(["datetime2", "datetimeoffset", "time"]);
const TYPES_WITH_PRECISION = new Set(["decimal", "numeric"]);

/** A column's type as written in DDL: `nvarchar(50)`, `varbinary(max)`, `decimal(8,2)`. */
export function formatType(column: Column1): string {
  const type = column.data_type;
  const lower = type.toLowerCase();
  if (TYPES_WITH_LENGTH.has(lower)) {
    if (column.is_max === true) {
      return `${type}(max)`;
    }
    return column.length === null || column.length === undefined
      ? type
      : `${type}(${String(column.length)})`;
  }
  if (TYPES_WITH_PRECISION.has(lower) && column.precision != null) {
    return `${type}(${String(column.precision)},${String(column.scale ?? 0)})`;
  }
  if (TYPES_WITH_SCALE.has(lower) && column.scale != null) {
    return `${type}(${String(column.scale)})`;
  }
  return type;
}

const BYTE_UNITS = ["bytes", "KB", "MB", "GB", "TB"] as const;

/** Bytes in a readable unit, 1024-based: `1.5 MB`. */
export function formatBytes(bytes: number): string {
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < BYTE_UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const text = unit === 0 ? String(value) : value.toFixed(value >= 10 ? 0 : 1);
  return `${text} ${BYTE_UNITS[unit] ?? "bytes"}`;
}

const rowCountCache = new WeakMap<object, Map<string, RowCount>>();

function rowCountFor(indexes: SnapshotIndexes, id: string): RowCount | undefined {
  let map = rowCountCache.get(indexes.snapshot);
  if (map === undefined) {
    map = new Map();
    for (const item of indexes.snapshot.row_counts?.items ?? []) {
      if (!map.has(item.object)) {
        map.set(item.object, item);
      }
    }
    rowCountCache.set(indexes.snapshot, map);
  }
  return map.get(id);
}

type SelectableEntity = Exclude<ObjectEntity, { kind: "synonym" }>;

function isSelectable(entity: Entity | undefined): entity is SelectableEntity {
  return entity?.kind === "table" || entity?.kind === "view" || entity?.kind === "routine";
}

function whatIs(entity: SelectableEntity): string {
  switch (entity.kind) {
    case "table":
      return "Table";
    case "view":
      return "View";
    case "routine":
      return ROUTINE_LABEL[entity.item.kind] ?? "Routine";
  }
}

function qualifiedOf(entity: ObjectEntity): string {
  return `${entity.schemaName}.${entity.item.name}`;
}

/** A link to an object by id; plain text when the id is not an object the panel can show. */
export function linkTo(indexes: SnapshotIndexes, id: string): ObjectLink {
  const entity = indexes.byId(id);
  if (isSelectable(entity)) {
    return { kind: "object", id, label: qualifiedOf(entity), what: whatIs(entity) };
  }
  if (entity?.kind === "synonym") {
    return { kind: "text", label: qualifiedOf(entity), what: "Synonym" };
  }
  return { kind: "text", label: "(object not in this snapshot)", what: "Missing object" };
}

function referenceText(reference: Reference): string {
  const { server, database, schema_name: schema, name } = reference.name;
  return [server, database, schema, name].filter((part) => part != null && part !== "").join(".");
}

/**
 * A dependency target. Only a target that resolves to an object in this snapshot becomes a link;
 * cross-database, cross-server, column-method and unresolved targets are labelled and stay text.
 */
function targetLink(indexes: SnapshotIndexes, reference: Reference): ObjectLink {
  const resolved = reference.resolved;
  if (reference.scope === "local" && resolved != null) {
    const entity = indexes.byId(resolved);
    if (entity !== undefined) {
      return linkTo(indexes, resolved);
    }
  }
  const scope = reference.scope === "local" ? SCOPE_LABEL.local : SCOPE_LABEL[reference.scope];
  return { kind: "text", label: referenceText(reference), what: scope };
}

function compareLinks(a: ObjectLink, b: ObjectLink): number {
  const keyA = `${a.label}\u0000${a.what}`;
  const keyB = `${b.label}\u0000${b.what}`;
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}

function uniqueLinks(links: readonly ObjectLink[]): ObjectLink[] {
  const seen = new Set<string>();
  const result: ObjectLink[] = [];
  for (const link of [...links].sort(compareLinks)) {
    const key = `${link.kind === "object" ? link.id : ""}\u0000${link.what}\u0000${link.label}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(link);
    }
  }
  return result;
}

function dependsOn(indexes: SnapshotIndexes, id: string): ObjectLink[] {
  return uniqueLinks(
    indexes.outgoingDependencies(id).map((dep) => targetLink(indexes, dep.target)),
  );
}

function usedBy(indexes: SnapshotIndexes, id: string): ObjectLink[] {
  return uniqueLinks(
    indexes.incomingDependencies(id).map((dep: Dependency) => linkTo(indexes, dep.from_object)),
  );
}

function columnName(indexes: SnapshotIndexes, id: string): string {
  const entity = indexes.byId(id);
  return entity?.kind === "column" ? entity.item.name : id;
}

function describeKeys(indexes: SnapshotIndexes, id: string, outgoing: boolean): ForeignKeyDetail[] {
  const keys = outgoing ? indexes.outgoingRelationships(id) : indexes.incomingRelationships(id);
  return keys
    .map((key) => {
      const flags: string[] = [];
      if (key.disabled === true) {
        flags.push("disabled");
      }
      if (key.trusted === false) {
        flags.push("not trusted");
      }
      const from = key.from_columns.map((c) => columnName(indexes, c)).join(", ");
      const to = key.to_columns.map((c) => columnName(indexes, c)).join(", ");
      return {
        id: key.id,
        name: key.name,
        other: linkTo(indexes, outgoing ? key.to_object : key.from_object),
        columns: outgoing ? `${from} → ${to}` : `${to} ← ${from}`,
        onDelete: ACTION_LABEL[key.on_delete ?? "no_action"],
        onUpdate: ACTION_LABEL[key.on_update ?? "no_action"],
        flags,
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1));
}

function describeColumns(indexes: SnapshotIndexes, table: Table): ColumnDetail[] {
  const primary = new Set<string>();
  const unique = new Set<string>();
  for (const key of table.key_constraints ?? []) {
    const target = key.kind === "primary_key" ? primary : unique;
    key.columns.forEach((c) => target.add(c));
  }
  const foreign = new Set<string>();
  for (const key of indexes.outgoingRelationships(table.id)) {
    key.from_columns.forEach((c) => foreign.add(c));
  }
  return [...table.columns]
    .sort((a, b) => a.ordinal - b.ordinal || (a.id < b.id ? -1 : 1))
    .map((column) => describeColumn(column, primary, unique, foreign));
}

function describeColumn(
  column: Column1,
  primary: ReadonlySet<string>,
  unique: ReadonlySet<string>,
  foreign: ReadonlySet<string>,
): ColumnDetail {
  return {
    id: column.id,
    name: column.name,
    type: formatType(column),
    nullable: column.nullable,
    identity: column.identity === true,
    computed:
      column.computed == null
        ? null
        : { definition: column.computed.definition ?? null, persisted: column.computed.persisted },
    defaultText: column.default == null ? null : (column.default.definition ?? ""),
    isPrimaryKey: primary.has(column.id),
    isUnique: unique.has(column.id),
    isForeignKey: foreign.has(column.id),
  };
}

function describeIndexes(indexes: SnapshotIndexes, table: Table): IndexDetail[] {
  return [...(table.indexes ?? [])]
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.id < b.id ? -1 : 1))
    .map((index) => ({
      id: index.id,
      name: index.name,
      kind: INDEX_KIND_LABEL[index.kind] ?? index.kind,
      unique: index.unique,
      disabled: index.disabled === true,
      keyColumns: index.key_columns.map(
        (k) => columnName(indexes, k.column) + (k.descending === true ? " desc" : ""),
      ),
      includedColumns: (index.included_columns ?? []).map((c) => columnName(indexes, c)),
      filter: index.filter ?? null,
    }));
}

function describeDefinition(
  status: DefinitionStatus,
  text: string | null | undefined,
): DefinitionDetail {
  const shown = status === "available" && text != null && text !== "" ? text : null;
  return { status, reason: definitionReason(status, shown !== null), text: shown };
}

/** Everything the detail panel shows for one object, or `undefined` if `id` is not a table, view or routine. */
export function describeObject(indexes: SnapshotIndexes, id: string): DetailModel | undefined {
  const entity = indexes.byId(id);
  if (!isSelectable(entity)) {
    return undefined;
  }
  const base = {
    id,
    kind: entity.kind,
    schemaName: entity.schemaName,
    name: entity.item.name,
    qualified: qualifiedOf(entity),
    description: entity.item.description ?? null,
    outgoingKeys: describeKeys(indexes, id, true),
    incomingKeys: describeKeys(indexes, id, false),
    dependsOn: dependsOn(indexes, id),
    usedBy: usedBy(indexes, id),
  } as const;
  const none = {
    parent: null,
    columns: [],
    keyConstraints: [],
    indexes: [],
    checks: [],
    rows: null,
    size: null,
    definition: null,
  } as const;

  if (entity.kind === "table") {
    const table = entity.item;
    const count = rowCountFor(indexes, id);
    return {
      ...base,
      ...none,
      kindLabel: "Table",
      columns: describeColumns(indexes, table),
      keyConstraints: [...(table.key_constraints ?? [])]
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((k) => ({
          name: k.name,
          kind: k.kind === "primary_key" ? "Primary key" : "Unique",
          columns: k.columns.map((c) => columnName(indexes, c)).join(", "),
        })),
      indexes: describeIndexes(indexes, table),
      checks: [...(table.check_constraints ?? [])]
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
        .map((c) => ({
          name: c.name,
          flags: [
            ...(c.disabled === true ? ["disabled"] : []),
            ...(c.trusted === false ? ["not trusted"] : []),
          ],
        })),
      rows: count === undefined ? NOT_AVAILABLE : count.rows.toLocaleString("en-US"),
      size: count?.reserved_bytes == null ? NOT_AVAILABLE : formatBytes(count.reserved_bytes),
    };
  }
  if (entity.kind === "view") {
    const columns = [...entity.item.columns]
      .sort((a, b) => a.ordinal - b.ordinal || (a.id < b.id ? -1 : 1))
      .map((column) => describeColumn(column, new Set(), new Set(), new Set()));
    return {
      ...base,
      ...none,
      kindLabel: "View",
      columns,
      definition: describeDefinition(entity.item.definition_status, entity.item.definition),
    };
  }
  const routine = entity.item;
  return {
    ...base,
    ...none,
    kindLabel: ROUTINE_LABEL[routine.kind] ?? "Routine",
    parent: routine.parent == null ? null : linkTo(indexes, routine.parent),
    definition: describeDefinition(routine.definition_status, routine.definition),
  };
}
