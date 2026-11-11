import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildIndexes } from "../snapshot/indexes";
import { parseSnapshot } from "../snapshot/parse";
import { bigSnapshot, indexesOf, makeSnapshot } from "../testing/snapshots";
import { TIER, matchText } from "./match";
import { buildSearchItems, searchItems } from "./searchIndex";

const BIN2 = readFileSync("src/snapshot/__fixtures__/bin2-edgecases.snapshot.json", "utf8");

function ids(items: ReturnType<typeof buildSearchItems>, query: string): string[] {
  return searchItems(items, query).map((r) => r.item.id);
}

describe("matchText", () => {
  const m = (text: string, query: string) => matchText(text, text.toLowerCase(), query);

  it("classifies exact, prefix, word boundary and fuzzy", () => {
    expect(m("Orders", "orders")?.tier).toBe(TIER.exact);
    expect(m("OrderLines", "order")?.tier).toBe(TIER.prefix);
    expect(m("SalesOrder", "order")?.tier).toBe(TIER.wordBoundary);
    expect(m("sales_order", "order")?.tier).toBe(TIER.wordBoundary);
    expect(m("Reorder", "order")?.tier).toBe(TIER.fuzzy);
    expect(m("CustomerAddress", "cstadr")?.tier).toBe(TIER.fuzzy);
    expect(m("Orders", "xyz")).toBeNull();
  });

  it("matches a word start after a digit or underscore, not mid-word", () => {
    expect(m("T1Order", "order")?.tier).toBe(TIER.wordBoundary);
    expect(m("shorder", "order")?.tier).toBe(TIER.fuzzy);
  });
});

describe("ranking", () => {
  const snapshot = makeSnapshot([
    ["dbo", "Reorder", ["Id"]],
    ["dbo", "SalesOrder", ["Id"]],
    ["dbo", "OrderLines", ["Id"]],
    ["dbo", "Order", ["Id"]],
    ["dbo", "OrderArchive", ["Id"]],
    ["sales", "Order", ["Id"]],
  ]);
  const items = buildSearchItems(indexesOf(snapshot));

  it("orders exact, then prefix (closest first), then word boundary, then fuzzy", () => {
    const table = (qualified: string) => `object:${qualified}`;
    const got = ids(items, "order").filter((id) => id.startsWith("object:"));
    expect(got).toEqual([
      table("dbo.Order"),
      table("sales.Order"),
      table("dbo.OrderLines"),
      table("dbo.OrderArchive"),
      table("dbo.SalesOrder"),
      table("dbo.Reorder"),
    ]);
  });

  it("breaks exact ties by id and is stable across runs", () => {
    const first = ids(items, "order");
    expect(ids(items, "order")).toEqual(first);
    expect(first.indexOf("object:dbo.Order")).toBeLessThan(first.indexOf("object:sales.Order"));
  });

  it("returns nothing for a blank query and caps the list", () => {
    expect(ids(items, "  ")).toEqual([]);
    expect(searchItems(items, "o", 2)).toHaveLength(2);
  });

  it("finds a table by its qualified name", () => {
    expect(ids(items, "sales.order")[0]).toBe("object:sales.Order");
  });

  it("finds columns, owned by their table", () => {
    const snap = makeSnapshot([["dbo", "Person", ["BusinessEntityID", "Email"]]]);
    const hit = searchItems(buildSearchItems(indexesOf(snap)), "email")[0]?.item;
    expect(hit?.kind).toBe("column");
    expect(hit?.targetId).toBe("object:dbo.Person");
    expect(hit?.context).toBe("dbo.Person");
  });

  it("lists tables before columns of the same name", () => {
    const snap = makeSnapshot([["dbo", "Orders", ["Orders"]]]);
    const kinds = searchItems(buildSearchItems(indexesOf(snap)), "orders").map((r) => r.item.kind);
    expect(kinds).toEqual(["table", "column"]);
  });
});

describe("case-variant names (BIN2 fixture)", () => {
  const indexes = buildIndexes(parseSnapshot(BIN2));
  const items = buildSearchItems(indexes);

  it("lists dbo.Orders and dbo.orders separately, with their schema", () => {
    const hits = searchItems(items, "orders")
      .map((r) => r.item)
      .filter((i) => i.kind === "table");
    expect(hits.map((h) => h.id)).toEqual(["object:dbo.Orders", "object:dbo.orders"]);
    expect(hits.map((h) => h.context)).toEqual(["dbo", "dbo"]);
    expect(hits.map((h) => h.name)).toEqual(["Orders", "orders"]);
  });

  it("includes views", () => {
    expect(ids(items, "lowerview")).toContain("object:dbo.LowerView");
  });
});

describe("speed", () => {
  it("searches 2,000 tables in under 100 ms", () => {
    const items = buildSearchItems(buildIndexes(bigSnapshot(2000, 12)));
    expect(items.length).toBeGreaterThan(20_000);
    searchItems(items, "warm");
    for (const query of ["o", "ord", "cust0", "ledgercol11", "s3.inv", "zzzz"]) {
      const start = performance.now();
      searchItems(items, query);
      expect(performance.now() - start).toBeLessThan(100);
    }
  });
});
