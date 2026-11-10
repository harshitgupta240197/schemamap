import type { SchemaMapSnapshotV1 } from "../generated/snapshot";
import { buildIndexes, type SnapshotIndexes } from "../snapshot/indexes";

/** A table in a test snapshot: `[schema, name, columnNames]`. */
export type TableSpec = readonly [string, string, readonly string[]];

/** A foreign key in a test snapshot: `[fromTable, toTable]` as `schema.name`. */
export type LinkSpec = readonly [string, string];

/** A view in a test snapshot: its `schema.name`, and the `schema.name` objects it reads. */
export type ViewSpec = readonly [string, readonly string[]];

/** Build a small valid-shaped snapshot. Not parsed through the validator; only for logic tests. */
export function makeSnapshot(
  tables: readonly TableSpec[],
  links: readonly LinkSpec[] = [],
  views: readonly ViewSpec[] = [],
): SchemaMapSnapshotV1 {
  const schemaNames = [
    ...new Set([...tables.map((t) => t[0]), ...views.map((v) => v[0].split(".")[0] ?? "")]),
  ];
  const column = (owner: string, name: string, ordinal: number) => ({
    id: `column:${owner}.${name}`,
    name,
    ordinal,
    data_type: "int",
    nullable: false,
  });
  const idOf = (qualified: string): string => `object:${qualified}`;
  return {
    format_version: "1.0",
    schemas: schemaNames.map((name) => ({ id: `schema:${name}`, name })),
    tables: tables.map(([schema, name, columns]) => ({
      id: idOf(`${schema}.${name}`),
      schema_id: `schema:${schema}`,
      name,
      columns: columns.map((c, i) => column(`${schema}.${name}`, c, i + 1)),
    })),
    views: views.map(([qualified]) => {
      const [schema = "", name = ""] = qualified.split(".");
      return {
        id: idOf(qualified),
        schema_id: `schema:${schema}`,
        name,
        columns: [column(qualified, "Id", 1)],
      };
    }),
    relationships: links.map(([from, to], i) => ({
      id: `foreign_key:${String(i)}`,
      name: `FK_${String(i)}`,
      edge: `edge:${from}>${to}`,
      from_object: idOf(from),
      from_columns: [],
      to_object: idOf(to),
      to_columns: [],
    })),
    dependencies: views.flatMap(([qualified, reads]) =>
      reads.map((target) => ({
        from_object: idOf(qualified),
        target: {
          scope: "local",
          name: { name: target.split(".")[1] ?? "", schema_name: target.split(".")[0] ?? null },
          resolved: idOf(target),
        },
      })),
    ),
  } as unknown as SchemaMapSnapshotV1;
}

export function indexesOf(snapshot: SchemaMapSnapshotV1): SnapshotIndexes {
  return buildIndexes(snapshot);
}

/** A synthetic snapshot with `count` tables of `columns` columns, chained by foreign keys. */
export function bigSnapshot(count: number, columns: number): SchemaMapSnapshotV1 {
  const tables: TableSpec[] = [];
  const links: LinkSpec[] = [];
  const names = ["Order", "Customer", "Invoice", "Product", "Ledger", "Shipment", "Account"];
  for (let i = 0; i < count; i += 1) {
    const schema = `s${String(i % 8)}`;
    const name = `${names[i % names.length] ?? "T"}${String(i)}`;
    tables.push([
      schema,
      name,
      Array.from({ length: columns }, (_, c) => `${name}Col${String(c)}`),
    ]);
    if (i > 0) {
      const parent = tables[Math.floor(i / 2)];
      if (parent !== undefined) {
        links.push([`${schema}.${name}`, `${parent[0]}.${parent[1]}`]);
      }
    }
  }
  return makeSnapshot(tables, links);
}
