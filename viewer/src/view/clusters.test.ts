import { describe, expect, it } from "vitest";
import type { SchemaMapSnapshotV1 } from "../generated/snapshot";
import { indexesOf, makeSnapshot, type LinkSpec, type TableSpec } from "../testing/snapshots";
import { LAYOUT_LIMIT } from "../graph/layout";
import { clusterTables, type Clustering } from "./clusters";

const t = (qualified: string) => `object:${qualified}`;
const table = (qualified: string): TableSpec => {
  const [schema = "", name = ""] = qualified.split(".");
  return [schema, name, ["Id"]];
};

function cluster(snapshot: SchemaMapSnapshotV1, limit?: number): Clustering {
  return clusterTables(indexesOf(snapshot), limit);
}

/** Cluster names with their sorted member ids, in cluster order. */
function shape(clustering: Clustering): [string, string[]][] {
  return clustering.clusters.map((c) => [c.name, [...c.tableIds]]);
}

describe("clusterTables", () => {
  // Sales: Orders - Lines - Products and Customers - Addresses (two components), Notes alone.
  // HR: Staff - Teams. One cross-schema key: Sales.Orders > HR.Staff.
  const tables = [
    "Sales.Orders",
    "Sales.Lines",
    "Sales.Products",
    "Sales.Customers",
    "Sales.Addresses",
    "Sales.Notes",
    "HR.Staff",
    "HR.Teams",
  ].map(table);
  const links: LinkSpec[] = [
    ["Sales.Lines", "Sales.Orders"],
    ["Sales.Lines", "Sales.Products"],
    ["Sales.Customers", "Sales.Addresses"],
    ["Sales.Orders", "HR.Staff"],
    ["HR.Staff", "HR.Teams"],
  ];
  const result = cluster(makeSnapshot(tables, links));

  it("groups by schema, then by connected component inside the schema", () => {
    expect(shape(result)).toEqual([
      ["HR", [t("HR.Staff"), t("HR.Teams")]],
      ["Sales · Lines", [t("Sales.Lines"), t("Sales.Orders"), t("Sales.Products")]],
      ["Sales · Addresses", [t("Sales.Addresses"), t("Sales.Customers")]],
      ["Sales · no relationships", [t("Sales.Notes")]],
    ]);
  });

  it("uses the smallest table id as the cluster id and maps every table to its cluster", () => {
    expect(result.clusters.map((c) => c.id)).toEqual([
      "cluster:object:HR.Staff",
      "cluster:object:Sales.Lines",
      "cluster:object:Sales.Addresses",
      "cluster:object:Sales.Notes",
    ]);
    expect(result.clusterOf.get(t("Sales.Products"))).toBe("cluster:object:Sales.Lines");
    expect(result.clusterOf.size).toBe(tables.length);
    expect(result.byId.get("cluster:object:HR.Staff")?.schemaName).toBe("HR");
  });

  it("turns cross-schema keys into counted cluster edges", () => {
    expect(result.edges).toEqual([
      { source: "cluster:object:Sales.Lines", target: "cluster:object:HR.Staff", count: 1 },
    ]);
    const sales = result.byId.get("cluster:object:Sales.Lines");
    const hr = result.byId.get("cluster:object:HR.Staff");
    expect([sales?.outgoing, sales?.incoming]).toEqual([1, 0]);
    expect([hr?.outgoing, hr?.incoming]).toEqual([0, 1]);
  });

  it("counts keys that share an edge id once, and ignores self-references", () => {
    const snapshot = makeSnapshot(["a.A", "a.B", "b.C"].map(table), [
      ["a.A", "b.C"],
      ["a.A", "b.C"],
      ["a.B", "a.B"],
    ]);
    const shared = cluster(snapshot);
    expect(shared.edges).toEqual([
      { source: "cluster:object:a.A", target: "cluster:object:b.C", count: 1 },
    ]);
    // A self-referencing table has no relationship with another table, so it counts as isolated.
    expect(shape(shared)).toEqual([
      ["a", [t("a.A"), t("a.B")]],
      ["b", [t("b.C")]],
    ]);
  });

  it("names a schema with one cluster after the schema, even when nothing relates", () => {
    const lonely = cluster(makeSnapshot(["Audit.Log", "Audit.Trail"].map(table)));
    expect(shape(lonely)).toEqual([["Audit", [t("Audit.Log"), t("Audit.Trail")]]]);
    expect(lonely.clusters[0]?.isolated).toBe(true);
  });

  it("picks the best-connected table as the hub, breaking ties by id", () => {
    const hub = cluster(
      makeSnapshot(["s.A", "s.B", "s.C", "s.D", "s.E", "s.F", "s.Lonely"].map(table), [
        ["s.B", "s.D"],
        ["s.C", "s.D"],
        ["s.E", "s.F"],
      ]),
    );
    expect(hub.clusters.map((c) => c.name)).toEqual(["s · D", "s · E", "s · no relationships"]);
  });

  it("splits a component over the limit into connected chunks within the limit", () => {
    const names = Array.from({ length: 25 }, (_, i) => `s.T${String(i).padStart(2, "0")}`);
    const chain: LinkSpec[] = names.slice(1).map((name, i) => [name, names[i] ?? ""]);
    const split = cluster(makeSnapshot(names.map(table), chain), 10);
    expect(split.clusters.map((c) => c.tableIds.length)).toEqual([10, 10, 5]);
    expect(split.clusters.flatMap((c) => c.tableIds).sort()).toEqual(names.map(t).sort());
    // Neighbouring chunks of the chain are joined by exactly one key.
    expect(split.edges.map((e) => e.count)).toEqual([1, 1]);
    expect(new Set(split.clusters.map((c) => c.name)).size).toBe(3);
  });

  it("splits a fan-out into a few full chunks, never into single tables", () => {
    const leaves = Array.from({ length: 25 }, (_, i) => `s.L${String(i).padStart(2, "0")}`);
    const star: LinkSpec[] = leaves.map((leaf) => [leaf, "s.Hub"]);
    const split = cluster(makeSnapshot(["s.Hub", ...leaves].map(table), star), 10);
    expect(split.clusters.map((c) => c.tableIds.length)).toEqual([10, 10, 6]);
    expect(split.clusters[0]?.tableIds).toContain(t("s.Hub"));
    // Each leaf chunk hangs off the hub: one edge per leaf, aggregated per chunk.
    expect(split.edges.map((e) => e.count)).toEqual([10, 6]);
  });

  it("splits a large group of unrelated tables into chunks in id order", () => {
    const names = Array.from({ length: 7 }, (_, i) => `s.T${String(i)}`);
    const split = cluster(makeSnapshot([...names, "s.X", "s.Y"].map(table), [["s.X", "s.Y"]]), 3);
    expect(shape(split)).toEqual([
      ["s · X", [t("s.X"), t("s.Y")]],
      ["s · no relationships (1 of 3)", [t("s.T0"), t("s.T1"), t("s.T2")]],
      ["s · no relationships (2 of 3)", [t("s.T3"), t("s.T4"), t("s.T5")]],
      ["s · no relationships (3 of 3)", [t("s.T6")]],
    ]);
  });

  it("does not depend on input order", () => {
    const shuffled = makeSnapshot([...tables].reverse(), [...links].reverse());
    const again = cluster(shuffled);
    expect(shape(again)).toEqual(shape(result));
    expect(again.edges).toEqual(result.edges);
  });

  it("keeps the first of duplicate table ids and skips keys to unknown tables", () => {
    const snapshot = makeSnapshot(["s.A", "s.A", "s.B"].map(table), [
      ["s.A", "s.B"],
      ["s.A", "s.Gone"],
    ]);
    expect(shape(cluster(snapshot))).toEqual([["s", [t("s.A"), t("s.B")]]]);
  });

  it("handles an empty snapshot", () => {
    expect(cluster(makeSnapshot([])).clusters).toEqual([]);
  });

  it("caps clusters at the layout limit by default", () => {
    expect(LAYOUT_LIMIT).toBe(200);
  });
});

describe("cluster labels and schema colours", () => {
  const snapshot = makeSnapshot(
    ["Sales.Orders", "Sales.Lines", "Sales.Products", "Sales.Notes", "Sales.Memos", "HR.Staff"].map(
      table,
    ),
    [
      ["Sales.Lines", "Sales.Orders"],
      ["Sales.Lines", "Sales.Products"],
    ],
  );
  const clustering = cluster(snapshot);

  it("titles a cluster with its most-connected table, or says it has no relationships", () => {
    const byName = new Map(clustering.clusters.map((c) => [c.name, c.hubName]));
    expect(byName.get("Sales · Lines")).toBe("Lines");
    expect(byName.get("Sales · no relationships")).toBe("No relationships");
    expect(byName.get("HR")).toBe("Staff");
    expect(clustering.clusters.some((c) => c.hubName === "Notes")).toBe(false);
  });

  it("gives every schema a colour slot in sorted order", () => {
    expect([...clustering.schemaColors]).toEqual([
      ["HR", 0],
      ["Sales", 1],
    ]);
  });
});
