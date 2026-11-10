import type { Column1, Relationship, SchemaMapSnapshotV1, Table } from "../generated/snapshot";

/**
 * A seeded, schema-valid synthetic snapshot for speed and scale tests. Nothing large is committed:
 * tests generate it when they need it. Same options, same JSON.
 *
 * Shape (for 2,000 tables): about a dozen schemas with Zipf-like sizes; in each, several
 * FK-connected components (a tree that favours early tables as hubs, plus extra keys, about 1.2
 * keys per table), about 10% tables with no keys, about 3% keys into another schema, a few
 * self-references, and in the largest schema one component of about 350 tables, larger than
 * one layout, so the overview has to split it.
 */
export interface SyntheticOptions {
  readonly tables: number;
  readonly seed: number;
}

const SCHEMAS = [
  "Sales",
  "Purchasing",
  "Inventory",
  "Finance",
  "HR",
  "Logistics",
  "Billing",
  "Catalog",
  "Support",
  "Marketing",
  "Audit",
  "Reporting",
];
const NOUNS = ["Order", "Customer", "Invoice", "Product", "Ledger", "Shipment", "Account"];
const DATA_COLUMNS: readonly (readonly [string, string, number | null])[] = [
  ["Name", "nvarchar", 100],
  ["Code", "varchar", 20],
  ["CreatedAt", "datetime2", null],
  ["UpdatedAt", "datetime2", null],
  ["Amount", "decimal", null],
  ["Status", "tinyint", null],
  ["Quantity", "int", null],
  ["Note", "nvarchar", 400],
  ["IsActive", "bit", null],
  ["Reference", "varchar", 50],
];
/** Size of the one component larger than a layout, in the largest schema. */
const GIANT_COMPONENT = 350;

/** mulberry32: a tiny, fast, seedable PRNG. Returns floats in [0, 1). */
function prng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Draft {
  readonly schema: string;
  readonly name: string;
  readonly keys: { readonly to: Draft; readonly column: string }[];
}

/** Table counts per schema, Zipf-like, summing to `total`, each at least 3. */
function schemaSizes(total: number): number[] {
  const count = Math.max(1, Math.min(SCHEMAS.length, Math.floor(total / 3)));
  const weights = Array.from({ length: count }, (_, i) => 1 / (i + 1));
  const sum = weights.reduce((a, b) => a + b, 0);
  const sizes = weights.map((w) => Math.max(3, Math.floor((w / sum) * total)));
  let excess = sizes.reduce((a, b) => a + b, 0) - total;
  for (let i = 0; excess !== 0; i = (i + 1) % count) {
    const step = excess > 0 ? -1 : 1;
    if (step > 0 || (sizes[i] ?? 0) > 3) {
      sizes[i] = (sizes[i] ?? 0) + step;
      excess += step;
    }
  }
  return sizes;
}

/** Component sizes for a schema of `size` tables, after its unrelated tables are set aside. */
function componentSizes(size: number, giant: boolean, random: () => number): number[] {
  const sizes: number[] = [];
  let left = size;
  if (giant && left > GIANT_COMPONENT) {
    sizes.push(GIANT_COMPONENT);
    left -= GIANT_COMPONENT;
  }
  while (left > 0) {
    const next = Math.min(left, 2 + Math.floor(random() ** 2 * 45));
    sizes.push(left - next === 1 ? left : next);
    left -= sizes[sizes.length - 1] ?? left;
  }
  return sizes;
}

function column(
  owner: string,
  name: string,
  ordinal: number,
  type: string,
  length: number | null,
): Column1 {
  return {
    id: `column:${owner}.${name}`,
    name,
    ordinal,
    data_type: type,
    user_type: null,
    length,
    is_max: false,
    precision: type === "decimal" ? 18 : null,
    scale: type === "decimal" ? 2 : null,
    nullable: ordinal > 1,
    identity: ordinal === 1,
    computed: null,
    default: null,
    collation: type.includes("char") ? "Latin1_General_100_CI_AS" : null,
    description: null,
  };
}

/** Build the synthetic snapshot described above. */
export function syntheticSnapshot({ tables, seed }: SyntheticOptions): SchemaMapSnapshotV1 {
  const random = prng(seed);
  const pick = <T>(items: readonly T[]): T => {
    const item = items[Math.floor(random() * items.length)];
    if (item === undefined) {
      throw new Error("pick from an empty list");
    }
    return item;
  };

  const drafts: Draft[] = [];
  const bySchema = new Map<string, Draft[]>();
  const newTable = (schema: string): Draft => {
    const index = drafts.length;
    const draft: Draft = {
      schema,
      name: `${NOUNS[index % NOUNS.length] ?? "T"}${String(index).padStart(4, "0")}`,
      keys: [],
    };
    drafts.push(draft);
    bySchema.get(schema)?.push(draft);
    return draft;
  };
  const addKey = (from: Draft, to: Draft): void => {
    const column = `${to.name}Id${from.keys.length > 0 ? String(from.keys.length + 1) : ""}`;
    from.keys.push({ to, column });
  };

  for (const [i, size] of schemaSizes(tables).entries()) {
    const schema = SCHEMAS[i] ?? `S${String(i)}`;
    bySchema.set(schema, []);
    const unrelated = Math.round(size * 0.1);
    for (let n = 0; n < unrelated; n += 1) {
      newTable(schema);
    }
    for (const componentSize of componentSizes(size - unrelated, i === 0, random)) {
      const members: Draft[] = [];
      for (let n = 0; n < componentSize; n += 1) {
        const table = newTable(schema);
        if (n > 0) {
          // Squaring favours early tables, so components grow hubs like real schemas do.
          addKey(table, members[Math.floor(random() ** 2 * n)] ?? table);
          const extra = members[Math.floor(random() * n)];
          if (random() < 0.2 && extra !== undefined && !table.keys.some((k) => k.to === extra)) {
            addKey(table, extra);
          }
        }
        if (random() < 0.01) {
          addKey(table, table);
        }
        members.push(table);
      }
    }
  }
  // Keys into another schema, from tables that already have a key (so none stops being unrelated).
  const schemaNames = [...bySchema.keys()];
  for (const table of drafts) {
    if (schemaNames.length > 1 && table.keys.length > 0 && random() < 0.03) {
      const other = pick(schemaNames.filter((name) => name !== table.schema));
      const targets = (bySchema.get(other) ?? []).filter((t) => t.keys.length > 0);
      if (targets.length > 0) {
        addKey(table, pick(targets));
      }
    }
  }

  const qualified = (draft: Draft): string => `${draft.schema}.${draft.name}`;
  const relationships: Relationship[] = [];
  const snapshotTables: Table[] = [];
  for (const draft of drafts) {
    const owner = qualified(draft);
    const dataCount = 2 + Math.floor(random() * 8);
    const columns = [column(owner, "Id", 1, "int", null)];
    for (const key of draft.keys) {
      columns.push(column(owner, key.column, columns.length + 1, "int", null));
    }
    for (let n = 0; n < dataCount; n += 1) {
      const [name, type, length] = DATA_COLUMNS[n % DATA_COLUMNS.length] ?? ["Extra", "int", null];
      columns.push(column(owner, name, columns.length + 1, type, length));
    }
    const pkName = `PK_${draft.schema}_${draft.name}`;
    const indexId = `index:${owner}.${pkName}`;
    snapshotTables.push({
      id: `object:${owner}`,
      schema_id: `schema:${draft.schema}`,
      name: draft.name,
      description: null,
      temporal_type: "none",
      memory_optimized: false,
      columns,
      indexes: [
        {
          id: indexId,
          name: pkName,
          kind: "clustered",
          unique: true,
          key_columns: [{ column: `column:${owner}.Id`, descending: false }],
          included_columns: [],
          filter: null,
          disabled: false,
        },
      ],
      key_constraints: [
        {
          id: `constraint:${draft.schema}.${pkName}`,
          name: pkName,
          kind: "primary_key",
          columns: [`column:${owner}.Id`],
          index: indexId,
        },
      ],
      check_constraints: [],
    });
    for (const key of draft.keys) {
      const target = qualified(key.to);
      const name = `FK_${draft.schema}_${draft.name}_${key.column}`;
      relationships.push({
        id: `foreign_key:${draft.schema}.${name}`,
        name,
        edge: `edge:${owner}(${key.column})>${target}(Id)`,
        from_object: `object:${owner}`,
        from_columns: [`column:${owner}.${key.column}`],
        to_object: `object:${target}`,
        to_columns: [`column:${target}.Id`],
        on_delete: "no_action",
        on_update: "no_action",
        disabled: false,
        trusted: true,
      });
    }
  }

  return {
    format: "schemamap.snapshot",
    format_version: "1.0",
    generator: { name: "schemamap", version: "0.0.1" },
    captured_at: "2000-01-01T00:00:00Z",
    source: {
      server: "localhost",
      server_redacted: false,
      database: `Synthetic${String(tables)}`,
      product_version: null,
      engine_edition: "3",
      edition: "Developer Edition (64-bit)",
      compatibility_level: 160,
      collation: "Latin1_General_100_CI_AS",
      query_store: "off",
    },
    schemas: schemaNames.map((name) => ({ id: `schema:${name}`, name, description: null })),
    tables: snapshotTables,
    views: [],
    routines: [],
    synonyms: [],
    relationships,
    dependencies: [],
    warnings: [],
    row_counts: null,
    query_history: null,
    join_evidence: null,
    filters: null,
  };
}
