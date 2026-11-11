import type {
  Column1,
  Dependency,
  Relationship,
  Routine,
  Schema,
  SchemaMapSnapshotV1,
  Synonym,
  Table,
  View,
} from "../generated/snapshot";

/** A named object that lives in a schema. */
export type ObjectEntity =
  | { kind: "table"; id: string; schemaName: string; item: Table }
  | { kind: "view"; id: string; schemaName: string; item: View }
  | { kind: "routine"; id: string; schemaName: string; item: Routine }
  | { kind: "synonym"; id: string; schemaName: string; item: Synonym };

/** Anything that can be looked up by id. */
export type Entity =
  | ObjectEntity
  | { kind: "schema"; id: string; item: Schema }
  | { kind: "column"; id: string; parentId: string; item: Column1 }
  | { kind: "relationship"; id: string; item: Relationship };

/** In-memory lookups over one snapshot. Built once; read-only afterwards. */
export interface SnapshotIndexes {
  readonly snapshot: SchemaMapSnapshotV1;
  /** Every schema, object, column and declared relationship by id. First occurrence wins. */
  byId(id: string): Entity | undefined;
  /** Exact, case-sensitive lookup of an object by schema and name. */
  byName(schemaName: string, name: string): ObjectEntity | undefined;
  /** Case-insensitive lookup; returns every match (case variants coexist on BIN2/CS databases). */
  byNameIgnoreCase(schemaName: string, name: string): readonly ObjectEntity[];
  /** Declared foreign keys leaving this object. */
  outgoingRelationships(objectId: string): readonly Relationship[];
  /** Declared foreign keys arriving at this object. */
  incomingRelationships(objectId: string): readonly Relationship[];
  /** Dependencies this object's definition creates. */
  outgoingDependencies(objectId: string): readonly Dependency[];
  /** Dependencies that resolved to this object (unresolved targets are not indexed). */
  incomingDependencies(objectId: string): readonly Dependency[];
  /** Ids that appeared more than once; only the first occurrence is indexed. */
  readonly duplicateIds: readonly string[];
}

const NONE: readonly never[] = Object.freeze([]);

// A NUL separator keeps ("a.b", "c") and ("a", "b.c") apart.
function nameKey(schemaName: string, name: string): string {
  return `${schemaName}\u0000${name}`;
}

function foldedKey(schemaName: string, name: string): string {
  return nameKey(schemaName.toLowerCase(), name.toLowerCase());
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list === undefined) {
    map.set(key, [value]);
  } else {
    list.push(value);
  }
}

/** Build all indexes for a validated snapshot. */
export function buildIndexes(snapshot: SchemaMapSnapshotV1): SnapshotIndexes {
  const entities = new Map<string, Entity>();
  const duplicateIds: string[] = [];
  const exact = new Map<string, ObjectEntity>();
  const folded = new Map<string, ObjectEntity[]>();
  const fkOut = new Map<string, Relationship[]>();
  const fkIn = new Map<string, Relationship[]>();
  const depOut = new Map<string, Dependency[]>();
  const depIn = new Map<string, Dependency[]>();

  const add = (entity: Entity): boolean => {
    if (entities.has(entity.id)) {
      duplicateIds.push(entity.id);
      return false;
    }
    entities.set(entity.id, entity);
    return true;
  };

  const schemaNames = new Map<string, string>();
  for (const schema of snapshot.schemas ?? []) {
    schemaNames.set(schema.id, schema.name);
    add({ kind: "schema", id: schema.id, item: schema });
  }

  const addObject = (entity: ObjectEntity): void => {
    if (!add(entity)) {
      return;
    }
    const name = entity.item.name;
    // Case-variant names are different keys here, so one never overwrites another.
    exact.set(nameKey(entity.schemaName, name), entity);
    push(folded, foldedKey(entity.schemaName, name), entity);
  };
  const schemaOf = (schemaId: string): string => schemaNames.get(schemaId) ?? "";

  for (const item of snapshot.tables ?? []) {
    addObject({ kind: "table", id: item.id, schemaName: schemaOf(item.schema_id), item });
    for (const column of item.columns) {
      add({ kind: "column", id: column.id, parentId: item.id, item: column });
    }
  }
  for (const item of snapshot.views ?? []) {
    addObject({ kind: "view", id: item.id, schemaName: schemaOf(item.schema_id), item });
    for (const column of item.columns) {
      add({ kind: "column", id: column.id, parentId: item.id, item: column });
    }
  }
  for (const item of snapshot.routines ?? []) {
    addObject({ kind: "routine", id: item.id, schemaName: schemaOf(item.schema_id), item });
  }
  for (const item of snapshot.synonyms ?? []) {
    addObject({ kind: "synonym", id: item.id, schemaName: schemaOf(item.schema_id), item });
  }

  for (const relationship of snapshot.relationships ?? []) {
    add({ kind: "relationship", id: relationship.id, item: relationship });
    push(fkOut, relationship.from_object, relationship);
    push(fkIn, relationship.to_object, relationship);
  }
  for (const dependency of snapshot.dependencies ?? []) {
    push(depOut, dependency.from_object, dependency);
    const resolved = dependency.target.resolved;
    if (resolved !== null && resolved !== undefined) {
      push(depIn, resolved, dependency);
    }
  }

  return {
    snapshot,
    duplicateIds,
    byId: (id) => entities.get(id),
    byName: (schemaName, name) => exact.get(nameKey(schemaName, name)),
    byNameIgnoreCase: (schemaName, name) => folded.get(foldedKey(schemaName, name)) ?? NONE,
    outgoingRelationships: (id) => fkOut.get(id) ?? NONE,
    incomingRelationships: (id) => fkIn.get(id) ?? NONE,
    outgoingDependencies: (id) => depOut.get(id) ?? NONE,
    incomingDependencies: (id) => depIn.get(id) ?? NONE,
  };
}
