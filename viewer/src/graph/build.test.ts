import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SchemaMapSnapshotV1 } from "../generated/snapshot";
import { buildIndexes } from "../snapshot/indexes";
import { parseSnapshot } from "../snapshot/parse";
import { buildGraph, nodeSize, sourceHandleId, targetHandleId, type Graph } from "./build";
import { toggleExpanded } from "./expanded";

/** The CLI's AdventureWorks golden, read in place. */
const AW_TEXT = readFileSync("../cli/tests/fixtures/adventureworks2022.snapshot.json", "utf8");
const BIN2_TEXT = readFileSync("src/snapshot/__fixtures__/bin2-edgecases.snapshot.json", "utf8");
const NONE: ReadonlySet<string> = new Set();

function load(text: string): SchemaMapSnapshotV1 {
  return parseSnapshot(text);
}

/** Expected edges, derived from the snapshot itself: distinct edge ids between two tables. */
function expectedEdgeIds(snapshot: SchemaMapSnapshotV1): string[] {
  const tables = new Set((snapshot.tables ?? []).map((t) => t.id));
  const ids = (snapshot.relationships ?? [])
    .filter((r) => tables.has(r.from_object) && tables.has(r.to_object))
    .map((r) => r.edge);
  return [...new Set(ids)].sort();
}

function handlesOf(graph: Graph, nodeId: string): Set<string> {
  const node = graph.nodes.find((n) => n.id === nodeId);
  const rows = node?.data.rows ?? [];
  return new Set(rows.flatMap((r) => [sourceHandleId(r.index), targetHandleId(r.index)]));
}

describe.each([
  ["AdventureWorks", AW_TEXT],
  ["BIN2 edge cases", BIN2_TEXT],
])("buildGraph on %s", (_label, text) => {
  const snapshot = load(text);
  const graph = buildGraph(buildIndexes(snapshot), NONE);

  it("has one node per table", () => {
    expect(graph.nodes).toHaveLength(snapshot.tables?.length ?? 0);
    expect(new Set(graph.nodes.map((n) => n.data.objectId))).toEqual(
      new Set((snapshot.tables ?? []).map((t) => t.id)),
    );
  });

  it("has one edge per distinct edge id", () => {
    expect(graph.edges.map((e) => e.data?.edgeId)).toEqual(expectedEdgeIds(snapshot));
  });

  it("anchors every edge on a column visible while collapsed", () => {
    for (const edge of graph.edges) {
      expect(handlesOf(graph, edge.source)).toContain(edge.sourceHandle);
      expect(handlesOf(graph, edge.target)).toContain(edge.targetHandle);
    }
  });

  it("is deterministic", () => {
    expect(buildGraph(buildIndexes(load(text)), NONE)).toEqual(graph);
  });

  it("keeps untrusted names out of React Flow ids", () => {
    for (const node of graph.nodes) {
      expect(node.id).toMatch(/^t\d+$/);
    }
    for (const edge of graph.edges) {
      expect(edge.id).toMatch(/^e\d+$/);
    }
  });
});

describe("buildGraph details", () => {
  const snapshot = load(AW_TEXT);
  const indexes = buildIndexes(snapshot);

  it("renders all 71 AdventureWorks tables", () => {
    expect(buildGraph(indexes, NONE).nodes).toHaveLength(71);
  });

  it("gives case-variant tables separate nodes (BIN2)", () => {
    const names = buildGraph(buildIndexes(load(BIN2_TEXT)), NONE).nodes.map((n) => n.data.name);
    expect(names).toContain("Orders");
    expect(names).toContain("orders");
  });

  it("shares one edge between FKs with identical columns", () => {
    const relationships = snapshot.relationships ?? [];
    const original = relationships[0];
    if (original === undefined) {
      throw new Error("golden has no relationships");
    }
    const twin = { ...original, id: `${original.id}_twin`, name: `${original.name}_twin` };
    const doubled = { ...snapshot, relationships: [...relationships, twin] };
    const graph = buildGraph(buildIndexes(doubled), NONE);
    expect(graph.edges).toHaveLength(expectedEdgeIds(snapshot).length);
    const shared = graph.edges.filter((e) => e.data?.edgeId === original.edge);
    expect(shared).toHaveLength(1);
    expect(shared[0]?.data?.foreignKeyIds).toEqual([original.id, twin.id]);
    expect(shared[0]?.data?.foreignKeyNames).toEqual([original.name, twin.name]);
  });

  it("marks primary and foreign key columns", () => {
    const graph = buildGraph(indexes, NONE);
    const history = graph.nodes.find(
      (n) => n.data.objectId === "object:HumanResources.EmployeeDepartmentHistory",
    );
    const department = history?.data.rows.find((r) => r.name === "DepartmentID");
    expect(department).toMatchObject({ isPrimaryKey: true, isForeignKey: true });
    expect(history?.data.schemaName).toBe("HumanResources");
  });

  it("shows key columns collapsed and every column expanded", () => {
    const target = "object:Person.Person";
    const table = (snapshot.tables ?? []).find((t) => t.id === target);
    const collapsed = buildGraph(indexes, NONE).nodes.find((n) => n.data.objectId === target);
    const open = buildGraph(indexes, toggleExpanded(NONE, target)).nodes.find(
      (n) => n.data.objectId === target,
    );
    expect(collapsed?.data.expanded).toBe(false);
    expect(collapsed?.data.rows.length).toBe(collapsed?.data.keyColumnCount);
    expect(collapsed?.data.rows.length).toBeLessThan(table?.columns.length ?? 0);
    expect(open?.data.expanded).toBe(true);
    expect(open?.data.rows.map((r) => r.name)).toEqual(
      [...(table?.columns ?? [])].sort((a, b) => a.ordinal - b.ordinal).map((c) => c.name),
    );
    expect(open?.height).toBe(nodeSize(table?.columns.length ?? 0).height);
    expect(open?.height ?? 0).toBeGreaterThan(collapsed?.height ?? 0);
  });

  it("expanding one table leaves the others alone", () => {
    const base = buildGraph(indexes, NONE);
    const after = buildGraph(indexes, toggleExpanded(NONE, "object:Person.Person"));
    const changed = after.nodes.filter((n, i) => n.height !== base.nodes[i]?.height);
    expect(changed.map((n) => n.data.objectId)).toEqual(["object:Person.Person"]);
    expect(after.edges).toEqual(base.edges);
  });
});

describe("toggleExpanded", () => {
  it("adds, removes and never mutates", () => {
    const once = toggleExpanded(NONE, "a");
    expect([...once]).toEqual(["a"]);
    expect(NONE.size).toBe(0);
    const twice = toggleExpanded(once, "a");
    expect(twice.size).toBe(0);
    expect(once.has("a")).toBe(true);
  });
});
