import { describe, expect, it } from "vitest";
import { indexesOf, makeSnapshot } from "../testing/snapshots";
import { clusterTables } from "../view/clusters";
import { layoutKey } from "./layout";
import { buildGraph } from "./build";
import { buildOverviewGraph, clusterLabel, overviewKey } from "./overview";

const indexes = indexesOf(
  makeSnapshot(
    [
      ["Sales", "Orders", ["Id"]],
      ["Sales", "Lines", ["Id"]],
      ["Sales", "Notes", ["Id"]],
      ["HR", "Staff", ["Id"]],
      ["HR", "Teams", ["Id"]],
    ],
    [
      ["Sales.Lines", "Sales.Orders"],
      ["Sales.Orders", "HR.Staff"],
      ["Sales.Lines", "HR.Staff"],
      ["HR.Staff", "HR.Teams"],
    ],
  ),
);
const clustering = clusterTables(indexes);

describe("buildOverviewGraph", () => {
  it("has one node per cluster and labelled edges between clusters", () => {
    const graph = buildOverviewGraph(clustering, []);
    expect(graph.nodes.map((n) => [n.id, n.data.name, n.data.tableCount])).toEqual([
      ["k0", "HR", 2],
      ["k1", "Sales · Lines", 2],
      ["k2", "Sales · no relationships", 1],
    ]);
    expect(graph.edges.map((e) => [e.id, e.source, e.target, e.label])).toEqual([
      ["ke0", "k1", "k0", "2"],
    ]);
    expect(graph.nodes[1]?.data).toMatchObject({ outgoing: 2, incoming: 0 });
    expect(graph.nodes[1]?.ariaLabel).toBe("Open cluster Sales · Lines, 2 tables");
    expect(graph.nodes.every((n) => n.width === 260 && n.height === 110)).toBe(true);
  });

  it("filters by schema, keeps ids stable and drops edges to hidden clusters", () => {
    const graph = buildOverviewGraph(clustering, ["schema:Sales"]);
    expect(graph.nodes.map((n) => n.id)).toEqual(["k1", "k2"]);
    expect(graph.edges).toEqual([]);
  });

  it("is deterministic and its cache key never matches a table view's", () => {
    const a = buildOverviewGraph(clustering, []);
    expect(buildOverviewGraph(clusterTables(indexes), [])).toEqual(a);
    expect(overviewKey(a).startsWith("c:")).toBe(true);
    expect(overviewKey(a)).not.toBe(layoutKey(buildGraph(indexes, new Set())));
    expect(overviewKey(buildOverviewGraph(clustering, ["schema:HR"]))).not.toBe(overviewKey(a));
  });

  it("labels singular and plural table counts", () => {
    expect(clusterLabel({ name: "x", tableCount: 1 })).toBe("Open cluster x, 1 table");
  });
});
