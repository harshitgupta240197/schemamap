import { describe, expect, it } from "vitest";
import { indexesOf, makeSnapshot, type LinkSpec, type TableSpec } from "../testing/snapshots";
import { clusterTables } from "../view/clusters";
import { foldSchemas } from "../view/schemaGroups";
import { layoutKey } from "./layout";
import { buildGraph } from "./build";
import {
  buildSchemaLevelGraph,
  buildSchemaOverviewGraph,
  clusterLabel,
  overviewKey,
  schemaNodeSize,
  schemaTiles,
  SCHEMA_MAX_TILES,
} from "./overview";

// Sales: Orders - Lines - Products (3, small), Notes alone (small): both fold into one group.
// HR: Staff - Teams - Roles - Grades (4, a tile). Keys from Sales into HR: Orders and Lines.
const tables: TableSpec[] = [
  ["Sales", "Orders", ["Id"]],
  ["Sales", "Lines", ["Id"]],
  ["Sales", "Products", ["Id"]],
  ["Sales", "Notes", ["Id"]],
  ["HR", "Staff", ["Id"]],
  ["HR", "Teams", ["Id"]],
  ["HR", "Roles", ["Id"]],
  ["HR", "Grades", ["Id"]],
];
const links: LinkSpec[] = [
  ["Sales.Lines", "Sales.Orders"],
  ["Sales.Lines", "Sales.Products"],
  ["Sales.Orders", "HR.Staff"],
  ["Sales.Lines", "HR.Staff"],
  ["HR.Staff", "HR.Teams"],
  ["HR.Teams", "HR.Roles"],
  ["HR.Roles", "HR.Grades"],
];
const indexes = indexesOf(makeSnapshot(tables, links));
const clustering = clusterTables(indexes);
const folding = foldSchemas(clustering);

describe("buildSchemaOverviewGraph", () => {
  const graph = buildSchemaOverviewGraph(folding, clustering, []);

  it("has one container per schema with its counts and tiles, and labelled schema edges", () => {
    expect(graph.nodes.map((n) => [n.id, n.data.schemaName, n.data.tableCount])).toEqual([
      ["s0", "HR", 4],
      ["s1", "Sales", 4],
    ]);
    expect(graph.nodes[0]?.data.tiles.map((t) => [t.kind, t.label, t.tableCount])).toEqual([
      ["cluster", "Roles", 4],
    ]);
    expect(graph.nodes[1]?.data.tiles.map((t) => [t.kind, t.label, t.tableCount])).toEqual([
      ["group", "Small groups", 4],
    ]);
    expect(graph.edges.map((e) => [e.id, e.source, e.target, e.label])).toEqual([
      ["se0", "s1", "s0", "2"],
    ]);
    expect(graph.nodes[1]?.ariaLabel).toBe("Open schema Sales, 4 tables");
  });

  it("filters by schema with stable ids and drops edges to hidden schemas", () => {
    const sales = buildSchemaOverviewGraph(folding, clustering, ["schema:Sales"]);
    expect(sales.nodes.map((n) => n.id)).toEqual(["s1"]);
    expect(sales.edges).toEqual([]);
  });

  it("sizes a container from its tile grid", () => {
    expect(schemaNodeSize(1, 1)).toEqual({ width: 300, height: 180 });
    expect(schemaNodeSize(12, 3)).toEqual({ width: 774, height: 360 });
    expect(graph.nodes[0]).toMatchObject({ width: 300, height: 180 });
  });
});

describe("schemaTiles", () => {
  it("keeps small groups and unrelated tables, and folds the smallest related clusters into +N", () => {
    const specs: TableSpec[] = [];
    const keys: LinkSpec[] = [];
    // 15 related clusters of 4 to 18 tables, two pairs (one small group), and 2 unrelated tables.
    for (let c = 0; c < 15; c += 1) {
      for (let i = 0; i < 4 + c; i += 1) {
        specs.push(["S", `C${String(c)}T${String(i)}`, ["Id"]]);
        if (i > 0) {
          keys.push([`S.C${String(c)}T${String(i)}`, `S.C${String(c)}T0`]);
        }
      }
    }
    specs.push(["S", "P1", ["Id"]], ["S", "P2", ["Id"]], ["S", "Q1", ["Id"]], ["S", "Q2", ["Id"]]);
    specs.push(["S", "U1", ["Id"]], ["S", "U2", ["Id"]]);
    keys.push(["S.P2", "S.P1"], ["S.Q2", "S.Q1"]);
    const big = foldSchemas(clusterTables(indexesOf(makeSnapshot(specs, keys))));
    const schema = big.schemaById.get("schema:S");
    if (schema === undefined) {
      throw new Error("no schema");
    }
    const tiles = schemaTiles(schema);
    expect(tiles).toHaveLength(SCHEMA_MAX_TILES);
    // The unrelated pair is itself a small cluster, so it folds with P and Q.
    expect(tiles.map((t) => t.kind)).toEqual([
      ...Array<string>(10).fill("cluster"),
      "more",
      "group",
    ]);
    expect(tiles[0]?.tableCount).toBe(18);
    expect(tiles[10]).toMatchObject({ label: "+5 clusters", tableCount: 4 + 5 + 6 + 7 + 8 });
    expect(tiles[11]).toMatchObject({ label: "Small groups", tableCount: 6 });
  });
});

describe("buildSchemaLevelGraph", () => {
  it("has a box per tile and per small group, and edges between them", () => {
    const sales = buildSchemaLevelGraph(folding, clustering, "schema:Sales");
    expect(
      sales.nodes.map((n) => [n.id, n.data.targetKind, n.data.name, n.data.tableCount]),
    ).toEqual([["g0", "group", "Sales · small groups", 4]]);
    expect(sales.nodes[0]?.ariaLabel).toBe("Open Sales · small groups, 4 tables in 2 groups");
    expect(sales.nodes[0]?.data.hubName).toBe("2 small groups");
    expect(sales.edges).toEqual([]);
    const hr = buildSchemaLevelGraph(folding, clustering, "schema:HR");
    expect(hr.nodes.map((n) => [n.id, n.data.targetKind, n.data.targetId])).toEqual([
      ["k0", "cluster", "cluster:object:HR.Grades"],
    ]);
    expect(hr.nodes[0]?.data).toMatchObject({ incoming: 2, outgoing: 0 });
    expect(buildSchemaLevelGraph(folding, clustering, "schema:Nope").nodes).toEqual([]);
  });

  it("labels clusters as before, with singular and plural counts", () => {
    expect(clusterLabel({ name: "x", tableCount: 1, groupCount: 0, targetKind: "cluster" })).toBe(
      "Open cluster x, 1 table",
    );
    expect(clusterLabel({ name: "y", tableCount: 2, groupCount: 1, targetKind: "group" })).toBe(
      "Open y, 2 tables in 1 group",
    );
  });
});

describe("overviewKey", () => {
  it("is deterministic and never matches a table view's or another level's key", () => {
    const overview = buildSchemaOverviewGraph(folding, clustering, []);
    expect(buildSchemaOverviewGraph(foldSchemas(clusterTables(indexes)), clustering, [])).toEqual(
      overview,
    );
    const key = overviewKey(overview);
    expect(key.startsWith("c:")).toBe(true);
    expect(key).not.toBe(layoutKey(buildGraph(indexes, new Set())));
    expect(key).not.toBe(overviewKey(buildSchemaLevelGraph(folding, clustering, "schema:HR")));
    expect(key).not.toBe(overviewKey(buildSchemaOverviewGraph(folding, clustering, ["schema:HR"])));
  });
});
