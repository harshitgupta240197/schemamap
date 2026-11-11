import { describe, expect, it } from "vitest";
import { indexesOf, makeSnapshot, type LinkSpec, type TableSpec } from "../testing/snapshots";
import { syntheticSnapshot } from "../testing/synthetic";
import { buildIndexes } from "../snapshot/indexes";
import { clusterTables } from "./clusters";
import { foldSchemas, type Folding } from "./schemaGroups";

const t = (qualified: string) => `object:${qualified}`;
const table = (qualified: string): TableSpec => {
  const [schema = "", name = ""] = qualified.split(".");
  return [schema, name, ["Id"]];
};

// Sales: A-B, A-C, A-D (4 tables), I-J-K (3), E-F (2), G-H (2), L alone.
// HR: X-Y (2, the schema's only small cluster), U-V-W-Z (4).
// Cross-schema keys: Sales.E > HR.X, Sales.A > HR.Z, Sales.G > HR.Z.
const tables = [
  ...["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L"].map((n) => `Sales.${n}`),
  ...["U", "V", "W", "X", "Y", "Z"].map((n) => `HR.${n}`),
].map(table);
const links: LinkSpec[] = [
  ["Sales.B", "Sales.A"],
  ["Sales.C", "Sales.A"],
  ["Sales.D", "Sales.A"],
  ["Sales.J", "Sales.I"],
  ["Sales.K", "Sales.J"],
  ["Sales.F", "Sales.E"],
  ["Sales.H", "Sales.G"],
  ["HR.Y", "HR.X"],
  ["HR.V", "HR.U"],
  ["HR.W", "HR.U"],
  ["HR.Z", "HR.U"],
  ["Sales.E", "HR.X"],
  ["Sales.A", "HR.Z"],
  ["Sales.G", "HR.Z"],
];

function fold(specs: readonly TableSpec[], keys: readonly LinkSpec[], limit?: number): Folding {
  const indexes = indexesOf(makeSnapshot(specs, keys));
  return foldSchemas(clusterTables(indexes), limit);
}

describe("foldSchemas", () => {
  const result = fold(tables, links);
  const sales = result.schemaById.get("schema:Sales");
  const hr = result.schemaById.get("schema:HR");

  it("lists every schema in cluster order with its table and cluster counts", () => {
    expect(result.schemas.map((s) => [s.schemaName, s.tableCount, s.clusterCount])).toEqual([
      ["HR", 6, 2],
      ["Sales", 12, 5],
    ]);
  });

  it("keeps clusters of more than 3 tables as tiles and folds the small ones into one group", () => {
    expect(sales?.tiles.map((c) => c.id)).toEqual(["cluster:object:Sales.A"]);
    expect(sales?.smallGroups).toHaveLength(1);
    const group = sales?.smallGroups[0];
    expect(group?.id).toBe("group:object:Sales.E");
    expect(group?.name).toBe("Sales · small groups");
    expect(group?.hubName).toBe("Small groups");
    expect(group?.clusterIds).toEqual([
      "cluster:object:Sales.I",
      "cluster:object:Sales.E",
      "cluster:object:Sales.G",
      "cluster:object:Sales.L",
    ]);
    expect(group?.tableIds).toEqual(
      ["E", "F", "G", "H", "I", "J", "K", "L"].map((n) => t(`Sales.${n}`)),
    );
    expect(result.groupOf.get(t("Sales.K"))).toBe("group:object:Sales.E");
    expect(result.groupOf.has(t("Sales.A"))).toBe(false);
    expect(result.groups.get("group:object:Sales.E")).toBe(group);
  });

  it("folds nothing when a schema has only one small cluster", () => {
    expect(hr?.tiles.map((c) => c.id)).toEqual(["cluster:object:HR.U", "cluster:object:HR.X"]);
    expect(hr?.smallGroups).toEqual([]);
    expect(result.groupOf.has(t("HR.X"))).toBe(false);
  });

  it("counts foreign keys between schemas once each", () => {
    expect(result.schemaEdges).toEqual([{ source: "schema:Sales", target: "schema:HR", count: 3 }]);
  });

  it("joins tiles and small groups with the keys between them", () => {
    expect(result.unitEdges).toEqual([
      { source: "cluster:object:Sales.A", target: "cluster:object:HR.U", count: 1 },
      { source: "group:object:Sales.E", target: "cluster:object:HR.U", count: 1 },
      { source: "group:object:Sales.E", target: "cluster:object:HR.X", count: 1 },
    ]);
    expect(result.unitOf.get("cluster:object:Sales.G")).toBe("group:object:Sales.E");
    expect(result.unitOf.get("cluster:object:Sales.A")).toBe("cluster:object:Sales.A");
    const group = sales?.smallGroups[0];
    expect([group?.outgoing, group?.incoming]).toEqual([2, 0]);
  });

  it("packs small groups into parts of at most `limit` tables, keeping clusters whole", () => {
    const parts = fold(tables, links, 5).schemaById.get("schema:Sales")?.smallGroups ?? [];
    expect(parts.map((g) => [g.id, g.name, g.hubName, g.tableIds.length])).toEqual([
      ["group:object:Sales.E", "Sales · small groups (1 of 2)", "Small groups (1 of 2)", 5],
      ["group:object:Sales.G", "Sales · small groups (2 of 2)", "Small groups (2 of 2)", 3],
    ]);
  });

  it("does not depend on the order of tables or keys", () => {
    const shuffled = fold([...tables].reverse(), [...links].reverse());
    expect(JSON.stringify(shuffled.schemas)).toBe(JSON.stringify(result.schemas));
    expect(shuffled.schemaEdges).toEqual(result.schemaEdges);
    expect(shuffled.unitEdges).toEqual(result.unitEdges);
  });

  it("turns the sparse 2,000-table synthetic into six schemas with a few tiles each", () => {
    const indexes = buildIndexes(syntheticSnapshot({ tables: 2000, seed: 2000, shape: "sparse" }));
    const sparse = foldSchemas(clusterTables(indexes));
    expect(sparse.schemas).toHaveLength(6);
    const boxes = sparse.schemas.map((s) => s.tiles.length + s.smallGroups.length);
    expect(Math.max(...boxes)).toBeLessThan(40);
    const shown = sparse.schemas.reduce(
      (sum, s) =>
        sum +
        s.tiles.reduce((n, c) => n + c.tableIds.length, 0) +
        s.smallGroups.reduce((n, g) => n + g.tableIds.length, 0),
      0,
    );
    expect(shown).toBe(2000);
  });
});
