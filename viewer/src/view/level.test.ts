import { describe, expect, it } from "vitest";
import { indexesOf, makeSnapshot, type LinkSpec, type TableSpec } from "../testing/snapshots";
import { clusterTables } from "./clusters";
import { visibleTables } from "./focus";
import {
  allowedHops,
  backToCluster,
  backToRoot,
  clampHops,
  drillInto,
  focusOn,
  rootTableCount,
  selectObject,
  viewLevel,
  withSchemas,
} from "./level";
import { formatHash, makeViewState, parseHash } from "./viewState";

const t = (qualified: string) => `object:${qualified}`;

/** `count` tables in schema `schema`, chained by keys: T0 < T1 < T2 ... */
function chain(schema: string, count: number): { tables: TableSpec[]; links: LinkSpec[] } {
  const tables: TableSpec[] = [];
  const links: LinkSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    tables.push([schema, `T${String(i).padStart(3, "0")}`, ["Id"]]);
    if (i > 0) {
      links.push([
        `${schema}.T${String(i).padStart(3, "0")}`,
        `${schema}.T${String(i - 1).padStart(3, "0")}`,
      ]);
    }
  }
  return { tables, links };
}

describe("viewLevel and the threshold", () => {
  const empty = makeViewState([], 1, []);

  it("shows the full map up to the limit and the overview above it", () => {
    expect(viewLevel(empty, 200)).toBe("map");
    expect(viewLevel(empty, 201)).toBe("overview");
    expect(viewLevel(empty, 0)).toBe("map");
  });

  it("puts focus before cluster before the root level", () => {
    expect(viewLevel(makeViewState([], 1, [], null, "cluster:x"), 5000)).toBe("cluster");
    expect(viewLevel(makeViewState(["object:a"], 1, [], null, "cluster:x"), 5000)).toBe("focus");
  });

  it("counts the root tables through the schema filter", () => {
    const a = chain("a", 150);
    const b = chain("b", 100);
    const indexes = indexesOf(makeSnapshot([...a.tables, ...b.tables], [...a.links, ...b.links]));
    expect(rootTableCount(indexes, [])).toBe(250);
    expect(rootTableCount(indexes, ["schema:a"])).toBe(150);
    // 250 tables open as the overview, but one schema of 150 fits the full map.
    expect(viewLevel(empty, rootTableCount(indexes, []))).toBe("overview");
    expect(
      viewLevel(makeViewState([], 1, ["schema:a"]), rootTableCount(indexes, ["schema:a"])),
    ).toBe("map");
  });
});

describe("drill-down and back", () => {
  const big = chain("s", 30);
  const indexes = indexesOf(makeSnapshot([...big.tables, ["s", "Alone", ["Id"]]], big.links));
  const clustering = clusterTables(indexes, 10);
  const first = clustering.clusters[0]?.id ?? "";

  it("drills into a cluster and shows only its tables", () => {
    const view = drillInto(makeViewState([], 2, ["schema:s"], t("s.Alone")), first);
    expect(view).toEqual(makeViewState([], 2, ["schema:s"], t("s.Alone"), first));
    const shown = visibleTables(indexes, view, clustering);
    expect([...(shown ?? [])].sort()).toEqual(clustering.byId.get(first)?.tableIds);
  });

  it("goes back up through the breadcrumb, keeping the selection", () => {
    // The Focus button acts on the selected table, so it is selected before focusing.
    const deep = focusOn(drillInto(makeViewState([], 1, [], t("s.T005")), first), t("s.T005"));
    expect(viewLevel(deep, 31)).toBe("focus");
    expect(backToCluster(deep)).toEqual(makeViewState([], 1, [], t("s.T005"), first));
    expect(backToRoot(deep)).toEqual(makeViewState([], 1, [], t("s.T005")));
  });

  it("focus walks keys across cluster boundaries", () => {
    const view = focusOn(drillInto(makeViewState([], 1, []), first), t("s.T009"));
    expect([...(visibleTables(indexes, view, clustering) ?? [])].sort()).toEqual([
      t("s.T008"),
      t("s.T009"),
      t("s.T010"),
    ]);
  });

  it("a schema change leaves the cluster", () => {
    const view = withSchemas(drillInto(makeViewState([], 1, []), first), ["schema:s"]);
    expect(view).toEqual(makeViewState([], 1, ["schema:s"]));
  });

  it("round-trips a drilled view through the hash", () => {
    const view = makeViewState([], 1, ["schema:s"], t("s.T001"), first);
    const hash = formatHash(view);
    expect(hash).toBe(
      `#schema=schema%3As&cluster=${encodeURIComponent(first)}&select=object%3As.T001`,
    );
    expect(parseHash(hash, indexes, new Set(clustering.byId.keys()))).toEqual(view);
  });
});

describe("selectObject", () => {
  const big = chain("s", 30);
  const indexes = indexesOf(
    makeSnapshot([...big.tables, ["s", "Alone", ["Id"]]], big.links, [["s.V", ["s.T001"]]]),
  );
  const clustering = clusterTables(indexes, 10);
  const clusterOfT25 = clustering.clusterOf.get(t("s.T025")) ?? "";
  const clusterOfT001 = clustering.clusterOf.get(t("s.T001")) ?? "";

  it("from the overview, a table drills into its cluster and is selected", () => {
    const next = selectObject(makeViewState([], 1, []), t("s.T025"), clustering, "overview");
    expect(next).toEqual(makeViewState([], 1, [], t("s.T025"), clusterOfT25));
  });

  it("from a cluster, a table elsewhere moves to its cluster; one on screen only selects", () => {
    const inCluster = makeViewState([], 1, [], null, clusterOfT001);
    expect(selectObject(inCluster, t("s.T025"), clustering, "cluster").cluster).toBe(clusterOfT25);
    expect(selectObject(inCluster, t("s.T002"), clustering, "cluster")).toEqual(
      makeViewState([], 1, [], t("s.T002"), clusterOfT001),
    );
  });

  it("views and routines only select, at any level", () => {
    const overview = makeViewState([], 1, []);
    expect(selectObject(overview, t("s.V"), clustering, "overview")).toEqual(
      makeViewState([], 1, [], t("s.V")),
    );
  });

  it("on the full map and in focus, a table only selects", () => {
    const focus = makeViewState([t("s.T001")], 1, []);
    expect(selectObject(focus, t("s.T025"), clustering, "focus")).toEqual(
      makeViewState([t("s.T001")], 1, [], t("s.T025")),
    );
    expect(selectObject(makeViewState([], 1, []), t("s.T025"), clustering, "map")).toEqual(
      makeViewState([], 1, [], t("s.T025")),
    );
  });
});

describe("hop limits", () => {
  // A hub with 150 direct neighbours, each with one neighbour of its own: 1 hop = 151 tables,
  // 2 hops = 301, over the limit.
  const tables: TableSpec[] = [["s", "Hub", ["Id"]]];
  const links: LinkSpec[] = [];
  for (let i = 0; i < 150; i += 1) {
    tables.push(["s", `A${String(i)}`, ["Id"]], ["s", `B${String(i)}`, ["Id"]]);
    links.push([`s.A${String(i)}`, "s.Hub"], [`s.B${String(i)}`, `s.A${String(i)}`]);
  }
  const indexes = indexesOf(makeSnapshot(tables, links));

  it("offers only the hops whose view fits the limit, and always 1", () => {
    expect(allowedHops(indexes, [t("s.Hub")], [])).toBe(1);
    expect(allowedHops(indexes, [t("s.B0")], [])).toBe(3);
    expect(allowedHops(indexes, [t("s.Hub")], [], 1)).toBe(1);
  });

  it("clamps a hash asking for too many hops", () => {
    const asked = makeViewState([t("s.Hub")], 3, []);
    expect(clampHops(indexes, asked).hops).toBe(1);
    const fine = makeViewState([t("s.B0")], 3, []);
    expect(clampHops(indexes, fine)).toBe(fine);
    const none = makeViewState([], 3, []);
    expect(clampHops(indexes, none)).toBe(none);
  });
});
