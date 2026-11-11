import { describe, expect, it } from "vitest";
import { LAYOUT_LIMIT } from "../graph/layout";
import { buildIndexes } from "../snapshot/indexes";
import { parseSnapshot } from "../snapshot/parse";
import { clusterTables } from "../view/clusters";
import { syntheticSnapshot } from "./synthetic";

describe("syntheticSnapshot", () => {
  const json = JSON.stringify(syntheticSnapshot({ tables: 2000, seed: 42 }));
  const snapshot = parseSnapshot(json);
  const indexes = buildIndexes(snapshot);

  it("passes the snapshot validator", () => {
    expect(snapshot.tables).toHaveLength(2000);
    expect(indexes.duplicateIds).toEqual([]);
  });

  it("is the same for the same seed and different for another", () => {
    expect(JSON.stringify(syntheticSnapshot({ tables: 2000, seed: 42 }))).toBe(json);
    expect(JSON.stringify(syntheticSnapshot({ tables: 2000, seed: 7 }))).not.toBe(json);
  });

  it("has realistic key density, cross-schema keys and self-references", () => {
    const relationships = snapshot.relationships ?? [];
    const perTable = relationships.length / 2000;
    expect(perTable).toBeGreaterThan(0.9);
    expect(perTable).toBeLessThan(1.5);
    const schemaOf = new Map((snapshot.tables ?? []).map((t) => [t.id, t.schema_id]));
    const cross = relationships.filter(
      (r) => schemaOf.get(r.from_object) !== schemaOf.get(r.to_object),
    );
    expect(cross.length).toBeGreaterThan(20);
    expect(relationships.some((r) => r.from_object === r.to_object)).toBe(true);
    // Every key points at real columns of real tables.
    for (const r of relationships) {
      expect(indexes.byId(r.from_columns[0])?.kind).toBe("column");
      expect(indexes.byId(r.to_columns[0])?.kind).toBe("column");
    }
  });

  it("clusters into many components, with one split for being larger than a layout", () => {
    const clustering = clusterTables(indexes);
    const schemas = new Set(clustering.clusters.map((c) => c.schemaId));
    expect(schemas.size).toBeGreaterThanOrEqual(10);
    expect(clustering.clusters.length).toBeGreaterThan(30);
    expect(clustering.clusters.every((c) => c.tableIds.length <= LAYOUT_LIMIT)).toBe(true);
    // The 350-table component in the largest schema becomes two chunks joined by keys.
    const sales = clustering.clusters.filter((c) => c.schemaName === "Sales" && !c.isolated);
    expect(sales.filter((c) => c.tableIds.length >= 100).length).toBeGreaterThanOrEqual(2);
    expect(clustering.clusters.some((c) => c.isolated)).toBe(true);
  });

  it("scales down to small sizes", () => {
    for (const tables of [3, 10, 250]) {
      const small = parseSnapshot(JSON.stringify(syntheticSnapshot({ tables, seed: 1 })));
      expect(small.tables).toHaveLength(tables);
    }
  });

  it("is the dense shape when no shape is given", () => {
    expect(JSON.stringify(syntheticSnapshot({ tables: 2000, seed: 42, shape: "dense" }))).toBe(
      json,
    );
  });
});

describe("syntheticSnapshot, sparse shape (like tools/synth.py)", () => {
  const json = JSON.stringify(syntheticSnapshot({ tables: 2000, seed: 42, shape: "sparse" }));
  const snapshot = parseSnapshot(json);
  const indexes = buildIndexes(snapshot);

  it("passes the snapshot validator with six schemas", () => {
    expect(snapshot.tables).toHaveLength(2000);
    expect(indexes.duplicateIds).toEqual([]);
    expect((snapshot.schemas ?? []).map((s) => s.name)).toEqual([
      "dbo",
      "sales",
      "hr",
      "inventory",
      "finance",
      "dw",
    ]);
  });

  it("is the same for the same seed and different for another", () => {
    expect(JSON.stringify(syntheticSnapshot({ tables: 2000, seed: 42, shape: "sparse" }))).toBe(
      json,
    );
    expect(JSON.stringify(syntheticSnapshot({ tables: 2000, seed: 7, shape: "sparse" }))).not.toBe(
      json,
    );
  });

  it("declares about 0.4 keys per table, each pointing at real columns", () => {
    const relationships = snapshot.relationships ?? [];
    const perTable = relationships.length / 2000;
    expect(perTable).toBeGreaterThan(0.35);
    expect(perTable).toBeLessThan(0.45);
    for (const r of relationships) {
      expect(indexes.byId(r.from_columns[0])?.kind).toBe("column");
      expect(indexes.byId(r.to_columns[0])?.kind).toBe("column");
    }
  });

  it("clusters into hundreds of boxes, mostly of 2 or 3 tables, as the real database does", () => {
    const clustering = clusterTables(indexes);
    expect(clustering.clusters.length).toBeGreaterThan(200);
    const small = clustering.clusters.filter(
      (c) => c.tableIds.length >= 2 && c.tableIds.length <= 3 && !c.isolated,
    );
    expect(small.length).toBeGreaterThan(150);
    expect(clustering.clusters.some((c) => c.tableIds.length > 10 && !c.isolated)).toBe(true);
  });

  it("scales down to small sizes", () => {
    for (const tables of [3, 10, 250]) {
      const small = parseSnapshot(
        JSON.stringify(syntheticSnapshot({ tables, seed: 1, shape: "sparse" })),
      );
      expect(small.tables).toHaveLength(tables);
    }
  });
});
