import type { SnapshotIndexes } from "./indexes";

/** How many distinct schema colours exist; later schemas reuse them in order. */
export const SCHEMA_PALETTE_SIZE = 8;

/**
 * Assign each schema a palette slot by its position in code-point order, so the same snapshot
 * always gets the same colours. The colours are `--sm-schema-<slot>` in tokens.css.
 */
export function assignSchemaColors(names: Iterable<string>): ReadonlyMap<string, number> {
  const sorted = [...new Set(names)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return new Map(sorted.map((name, i) => [name, i % SCHEMA_PALETTE_SIZE]));
}

/** The colour slot of every schema in a snapshot, including schemas that hold no tables. */
export function schemaColorsOf(indexes: SnapshotIndexes): ReadonlyMap<string, number> {
  const names: string[] = [];
  for (const schema of indexes.snapshot.schemas ?? []) {
    names.push(schema.name);
  }
  for (const table of indexes.snapshot.tables ?? []) {
    const entity = indexes.byId(table.id);
    if (entity?.kind === "table") {
      names.push(entity.schemaName);
    }
  }
  return assignSchemaColors(names);
}
