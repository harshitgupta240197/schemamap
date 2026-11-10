import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndexes } from "../snapshot/indexes";
import { parseSnapshot } from "../snapshot/parse";
import { indexesOf, makeSnapshot } from "../testing/snapshots";
import { buildGraph } from "../graph/build";
import { expandHops, tablesReferencedBy, visibleTables } from "./focus";
import { FULL_MAP, formatHash, makeViewState, parseHash, sameView } from "./viewState";

const AW = readFileSync("../cli/tests/fixtures/adventureworks2022.snapshot.json", "utf8");
const t = (name: string) => `object:dbo.${name}`;

// A - B - C - D chain, E self-references, X - Y - X cycle, F alone.
const snapshot = makeSnapshot(
  ["A", "B", "C", "D", "E", "X", "Y", "F"].map((n) => ["dbo", n, ["Id"]] as const),
  [
    ["dbo.A", "dbo.B"],
    ["dbo.C", "dbo.B"],
    ["dbo.C", "dbo.D"],
    ["dbo.E", "dbo.E"],
    ["dbo.X", "dbo.Y"],
    ["dbo.Y", "dbo.X"],
  ],
);
const indexes = indexesOf(snapshot);
const reach = (root: string, hops: number) => [...expandHops(indexes, [t(root)], hops)].sort();

describe("expandHops", () => {
  it("follows keys in both directions, one hop at a time", () => {
    expect(reach("B", 1)).toEqual([t("A"), t("B"), t("C")]);
    expect(reach("A", 2)).toEqual([t("A"), t("B"), t("C")]);
    expect(reach("A", 3)).toEqual([t("A"), t("B"), t("C"), t("D")]);
    expect(reach("D", 1)).toEqual([t("C"), t("D")]);
  });

  it("handles self-references and cycles", () => {
    expect(reach("E", 3)).toEqual([t("E")]);
    expect(reach("X", 1)).toEqual([t("X"), t("Y")]);
    expect(reach("X", 3)).toEqual([t("X"), t("Y")]);
  });

  it("keeps an isolated table alone and ignores unknown roots", () => {
    expect(reach("F", 3)).toEqual([t("F")]);
    expect([...expandHops(indexes, ["object:nope"], 2)]).toEqual([]);
  });

  it("stays within allowed tables but always keeps the roots", () => {
    const allowed = new Set([t("B"), t("C")]);
    expect([...expandHops(indexes, [t("A")], 3, allowed)].sort()).toEqual([t("A"), t("B"), t("C")]);
  });
});

describe("visibleTables", () => {
  it("is null for the full map and the schema filter narrows by schema", () => {
    expect(visibleTables(indexes, FULL_MAP)).toBeNull();
    const two = indexesOf(
      makeSnapshot([
        ["a", "T1", ["Id"]],
        ["b", "T2", ["Id"]],
      ]),
    );
    expect([...(visibleTables(two, makeViewState([], 1, ["schema:b"])) ?? [])]).toEqual([
      "object:b.T2",
    ]);
  });

  it("combines focus, hops and the schema filter", () => {
    const state = makeViewState([t("B")], 2, ["schema:dbo"]);
    expect([...(visibleTables(indexes, state) ?? [])].sort()).toEqual([
      t("A"),
      t("B"),
      t("C"),
      t("D"),
    ]);
  });

  it("builds a graph limited to the visible tables, with stable node ids", () => {
    const full = buildGraph(indexes, new Set());
    const narrow = buildGraph(
      indexes,
      new Set(),
      visibleTables(indexes, makeViewState([t("B")], 1, [])),
    );
    expect(narrow.nodes.map((n) => n.data.objectId)).toEqual([t("A"), t("B"), t("C")]);
    expect(narrow.edges).toHaveLength(2);
    for (const node of narrow.nodes) {
      expect(full.nodes.find((n) => n.data.objectId === node.data.objectId)?.id).toBe(node.id);
    }
  });
});

describe("tablesReferencedBy", () => {
  const withViews = indexesOf(
    makeSnapshot(
      [
        ["dbo", "A", ["Id"]],
        ["dbo", "B", ["Id"]],
      ],
      [],
      [
        ["dbo.V1", ["dbo.A", "dbo.V2"]],
        ["dbo.V2", ["dbo.B", "dbo.V1"]],
      ],
    ),
  );

  it("reads through nested views and survives view cycles", () => {
    expect(tablesReferencedBy(withViews, "object:dbo.V1")).toEqual([t("A"), t("B")]);
    expect(tablesReferencedBy(withViews, "object:dbo.V2")).toEqual([t("A"), t("B")]);
  });

  it("works on a real view of AdventureWorks", () => {
    const aw = buildIndexes(parseSnapshot(AW));
    const tables = tablesReferencedBy(aw, "object:HumanResources.vEmployee");
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every((id) => aw.byId(id)?.kind === "table")).toBe(true);
  });
});

describe("view hash", () => {
  it("round-trips, including ids that need encoding", () => {
    const odd = indexesOf(
      makeSnapshot([
        ["dbo", "A&B=C", ["Id"]],
        ["dbo", "Plain", ["Id"]],
      ]),
    );
    const state = makeViewState(["object:dbo.A&B=C", "object:dbo.Plain"], 3, ["schema:dbo"]);
    const hash = formatHash(state);
    expect(hash).toContain("focus=object%3Adbo.A%26B%3DC");
    expect(parseHash(hash, odd)).toEqual(state);
  });

  it("writes nothing for the default view and omits default hops", () => {
    expect(formatHash(FULL_MAP)).toBe("");
    expect(formatHash(makeViewState([t("A")], 1, []))).toBe("#focus=object%3Adbo.A");
    expect(sameView(parseHash("", indexes), FULL_MAP)).toBe(true);
  });

  it("round-trips the BIN2 case variants separately", () => {
    const bin2 = buildIndexes(
      parseSnapshot(readFileSync("src/snapshot/__fixtures__/bin2-edgecases.snapshot.json", "utf8")),
    );
    const upper = makeViewState(["object:dbo.Orders"], 2, []);
    const lower = makeViewState(["object:dbo.orders"], 2, []);
    expect(parseHash(formatHash(upper), bin2)).toEqual(upper);
    expect(parseHash(formatHash(lower), bin2)).toEqual(lower);
  });

  it.each([
    "#focus=%3Cscript%3E",
    "#focus=object%3Adbo.Missing",
    "#focus=%E0%A4%A",
    "#focus=%",
    "#hops=9&hops=-1&hops=1e1&hops=%3Cb%3E",
    "#schema=object%3Adbo.A",
    "#focus",
    "#=&&==&focus=",
    "#focus=" + "x".repeat(100_000),
    "#__proto__=1&constructor=2&focus=%00",
    "garbage",
    "",
  ])("ignores %j without throwing", (hash) => {
    expect(parseHash(hash, indexes)).toEqual(FULL_MAP);
  });

  it("keeps the valid parts of a partly hostile hash", () => {
    const state = parseHash("#focus=%3Cscript%3E&focus=object%3Adbo.B&hops=2&schema=nope", indexes);
    expect(state).toEqual(makeViewState([t("B")], 2, []));
  });

  it("only accepts tables as focus, not views or columns", () => {
    expect(parseHash("#focus=column%3Adbo.A.Id", indexes)).toEqual(FULL_MAP);
  });
});
