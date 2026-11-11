import { describe, expect, it } from "vitest";
import { indexesOf, makeSnapshot, type LinkSpec, type TableSpec } from "../testing/snapshots";
import { clusterTables } from "./clusters";
import { visibleTables } from "./focus";
import {
  allowedHops,
  backToCluster,
  backToRoot,
  backToSchema,
  clampHops,
  drillGroup,
  drillInto,
  drillSchema,
  focusOn,
  levelSchema,
  levelSizes,
  rootLevel,
  selectObject,
  viewLevel,
  withSchemas,
  type LevelSizes,
  type Places,
} from "./level";
import { foldSchemas } from "./schemaGroups";
import { formatHash, makeViewState, parseHash } from "./viewState";

const t = (qualified: string) => `object:${qualified}`;

/** Sizes for `viewLevel`: `root` tables over `rootSchemas` schemas, `drill` in a drilled schema. */
const sizes = (root: number, rootSchemas = 2, drill = 0): LevelSizes => ({
  root,
  rootSchemas,
  drill,
});

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
    expect(viewLevel(empty, sizes(200))).toBe("map");
    expect(viewLevel(empty, sizes(201))).toBe("overview");
    expect(viewLevel(empty, sizes(0))).toBe("map");
  });

  it("puts focus before cluster before the root level", () => {
    expect(viewLevel(makeViewState([], 1, [], null, "cluster:x"), sizes(5000))).toBe("cluster");
    expect(viewLevel(makeViewState(["object:a"], 1, [], null, "cluster:x"), sizes(5000))).toBe(
      "focus",
    );
  });

  it("counts the root tables through the schema filter", () => {
    const a = chain("a", 150);
    const b = chain("b", 100);
    const indexes = indexesOf(makeSnapshot([...a.tables, ...b.tables], [...a.links, ...b.links]));
    expect(levelSizes(indexes, empty).root).toBe(250);
    expect(levelSizes(indexes, makeViewState([], 1, ["schema:a"])).root).toBe(150);
    // 250 tables open as the overview, but one schema of 150 fits the full map.
    expect(viewLevel(empty, levelSizes(indexes, empty))).toBe("overview");
    const onlyA = makeViewState([], 1, ["schema:a"]);
    expect(viewLevel(onlyA, levelSizes(indexes, onlyA))).toBe("map");
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
    expect(viewLevel(deep, sizes(31))).toBe("focus");
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
  // One schema of 31 tables: in this world the root shows that schema's boxes.
  const places: Places = { clustering, folding: foldSchemas(clustering), rootLevel: "schema" };
  const clusterOfT25 = clustering.clusterOf.get(t("s.T025")) ?? "";
  const clusterOfT001 = clustering.clusterOf.get(t("s.T001")) ?? "";

  it("from the overview, a table drills into its cluster and is selected", () => {
    const next = selectObject(makeViewState([], 1, []), t("s.T025"), places, "overview");
    expect(next).toEqual(makeViewState([], 1, [], t("s.T025"), clusterOfT25));
  });

  it("from a cluster, a table elsewhere moves to its cluster; one on screen only selects", () => {
    const inCluster = makeViewState([], 1, [], null, clusterOfT001);
    expect(selectObject(inCluster, t("s.T025"), places, "cluster").cluster).toBe(clusterOfT25);
    expect(selectObject(inCluster, t("s.T002"), places, "cluster")).toEqual(
      makeViewState([], 1, [], t("s.T002"), clusterOfT001),
    );
  });

  it("views and routines only select, at any level", () => {
    const overview = makeViewState([], 1, []);
    expect(selectObject(overview, t("s.V"), places, "overview")).toEqual(
      makeViewState([], 1, [], t("s.V")),
    );
  });

  it("on the full map and in focus, a table only selects", () => {
    const focus = makeViewState([t("s.T001")], 1, []);
    expect(selectObject(focus, t("s.T025"), places, "focus")).toEqual(
      makeViewState([t("s.T001")], 1, [], t("s.T025")),
    );
    expect(selectObject(makeViewState([], 1, []), t("s.T025"), places, "map")).toEqual(
      makeViewState([], 1, [], t("s.T025")),
    );
  });
});

describe("schema overview levels", () => {
  // Schema a: a 250-table chain (split in two clusters) and two pairs P and Q (small groups).
  // Schema b: a 20-table chain. 274 tables in two schemas: the root is the schema overview.
  const a = chain("a", 250);
  const b = chain("b", 20);
  const indexes = indexesOf(
    makeSnapshot(
      [
        ...a.tables,
        ...b.tables,
        ["a", "P1", ["Id"]],
        ["a", "P2", ["Id"]],
        ["a", "Q1", ["Id"]],
        ["a", "Q2", ["Id"]],
      ],
      [...a.links, ...b.links, ["a.P2", "a.P1"], ["a.Q2", "a.Q1"]],
    ),
  );
  const clustering = clusterTables(indexes);
  const folding = foldSchemas(clustering);
  const group = folding.groupOf.get(t("a.P1")) ?? "";
  const root = makeViewState([], 1, []);
  const places: Places = { clustering, folding, rootLevel: rootLevel(indexes, root) };
  const levelOf = (view: ReturnType<typeof makeViewState>) =>
    viewLevel(view, levelSizes(indexes, view));

  it("opens on the schema overview, and on one schema's boxes when only it is in view", () => {
    expect(levelSizes(indexes, root)).toEqual({ root: 274, rootSchemas: 2, drill: 0 });
    expect(levelOf(root)).toBe("overview");
    expect(levelOf(makeViewState([], 1, ["schema:a"]))).toBe("schema");
    expect(levelSchema(indexes, makeViewState([], 1, ["schema:a"]))).toBe("schema:a");
    expect(levelSchema(indexes, root)).toBeNull();
  });

  it("drills into a schema: its boxes when it is large, its table map when it fits", () => {
    expect(levelOf(drillSchema(root, "schema:a"))).toBe("schema");
    const small = drillSchema(root, "schema:b");
    expect(levelOf(small)).toBe("map");
    expect(levelSchema(indexes, small)).toBe("schema:b");
    expect(visibleTables(indexes, small, clustering, folding)?.size).toBe(20);
  });

  it("drills into a small group and shows its tables", () => {
    expect(group).toMatch(/^group:/);
    const view = drillGroup(drillSchema(root, "schema:a"), group);
    expect(view).toEqual(makeViewState([], 1, [], null, null, null, group));
    expect(levelOf(view)).toBe("cluster");
    expect([...(visibleTables(indexes, view, clustering, folding) ?? [])].sort()).toEqual([
      t("a.P1"),
      t("a.P2"),
      t("a.Q1"),
      t("a.Q2"),
    ]);
  });

  it("keeps the place through a focus and leads back to it, then to the schema and the root", () => {
    const deep = focusOn(drillGroup(root, group), t("a.P1"));
    expect(levelOf(deep)).toBe("focus");
    expect(backToCluster(deep)).toEqual(drillGroup(root, group));
    expect(backToSchema(deep, "schema:a")).toEqual(drillSchema(root, "schema:a"));
    expect(backToRoot(deep)).toEqual(root);
    expect(withSchemas(drillSchema(root, "schema:a"), ["schema:b"])).toEqual(
      makeViewState([], 1, ["schema:b"]),
    );
  });

  it("keeps one place: a cluster wins over a group, a group over a schema", () => {
    const both = makeViewState([], 1, [], null, "cluster:x", "schema:a", group);
    expect([both.cluster, both.group, both.drill]).toEqual(["cluster:x", null, null]);
    const groupAndDrill = makeViewState([], 1, [], null, null, "schema:a", group);
    expect([groupAndDrill.group, groupAndDrill.drill]).toEqual([group, null]);
  });

  it("a selection moves to the deepest view that shows the table", () => {
    // A schema that fits one layout: its table map.
    expect(selectObject(root, t("b.T005"), places, "overview")).toEqual(
      makeViewState([], 1, [], t("b.T005"), null, "schema:b"),
    );
    // A large schema: the small group, or the cluster.
    expect(selectObject(root, t("a.Q2"), places, "overview")).toEqual(
      makeViewState([], 1, [], t("a.Q2"), null, null, group),
    );
    expect(selectObject(drillSchema(root, "schema:a"), t("a.T100"), places, "schema")).toEqual(
      makeViewState([], 1, [], t("a.T100"), clustering.clusterOf.get(t("a.T100"))),
    );
  });

  it("a selection already on screen only selects", () => {
    const inGroup = drillGroup(root, group);
    expect(selectObject(inGroup, t("a.Q1"), places, "cluster")).toEqual(
      makeViewState([], 1, [], t("a.Q1"), null, null, group),
    );
    const schemaMap = drillSchema(root, "schema:b");
    expect(selectObject(schemaMap, t("b.T001"), places, "map")).toEqual(
      makeViewState([], 1, [], t("b.T001"), null, "schema:b"),
    );
    // From the schema map of b, a table of a moves.
    expect(selectObject(schemaMap, t("a.P1"), places, "map").group).toBe(group);
  });

  it("round-trips group and drill through the hash", () => {
    const groups = new Set(folding.groups.keys());
    const clusters = new Set(clustering.byId.keys());
    for (const view of [
      makeViewState([], 1, [], t("a.P1"), null, null, group),
      makeViewState([], 1, ["schema:a"], null, null, "schema:b"),
      makeViewState([t("a.P1")], 2, [], null, null, null, group),
    ]) {
      expect(parseHash(formatHash(view), indexes, clusters, groups)).toEqual(view);
    }
    expect(formatHash(drillGroup(root, group))).toBe(`#group=${encodeURIComponent(group)}`);
    expect(formatHash(drillSchema(root, "schema:b"))).toBe("#drill=schema%3Ab");
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
