import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { SnapshotLoadError } from "./errors";
import { buildIndexes } from "./indexes";
import { INLINE_DATA_ID, loadSnapshotFile, readInlineSnapshot } from "./load";
import { MAX_REPORTED_VIOLATIONS, parseSnapshot } from "./parse";

/** The AdventureWorks golden is the CLI's own file, read in place so the two cannot drift. */
const AW = readFileSync("../cli/tests/fixtures/adventureworks2022.snapshot.json", "utf8");
/** A real `schemamap extract` of SchemaMapEdgeCasesBIN2 (see __fixtures__/README.md). */
/** A real extract of WideWorldImporters as `schemamap_reader`, read in place (normalised like the AW golden). */
const WWI = readFileSync("../cli/tests/fixtures/wideworldimporters.snapshot.json", "utf8");
const BIN2 = readFileSync("src/snapshot/__fixtures__/bin2-edgecases.snapshot.json", "utf8");

function withVersion(version: unknown): string {
  const doc = JSON.parse(BIN2) as Record<string, unknown>;
  if (version === undefined) {
    delete doc["format_version"];
  } else {
    doc["format_version"] = version;
  }
  return JSON.stringify(doc);
}

function failure(run: () => unknown): SnapshotLoadError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(SnapshotLoadError);
    return error as SnapshotLoadError;
  }
  throw new Error("expected SnapshotLoadError");
}

async function asyncFailure(run: () => Promise<unknown>): Promise<SnapshotLoadError> {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(SnapshotLoadError);
    return error as SnapshotLoadError;
  }
  throw new Error("expected SnapshotLoadError");
}

describe("loader", () => {
  it("reads the inline script via textContent", () => {
    const doc = document.implementation.createHTMLDocument("t");
    const script = doc.createElement("script");
    script.type = "application/json";
    script.id = INLINE_DATA_ID;
    script.textContent = BIN2;
    doc.body.append(script);
    expect(readInlineSnapshot(doc)?.source.database).toBe("SchemaMapEdgeCasesBIN2");
  });

  it("returns null when there is no inline data", () => {
    expect(readInlineSnapshot(document.implementation.createHTMLDocument("t"))).toBeNull();
  });

  it("treats the empty placeholder the build ships as no inline snapshot", () => {
    for (const text of ["", "  \n "]) {
      const doc = document.implementation.createHTMLDocument("t");
      const script = doc.createElement("script");
      script.type = "application/json";
      script.id = INLINE_DATA_ID;
      script.textContent = text;
      doc.body.append(script);
      expect(readInlineSnapshot(doc)).toBeNull();
    }
  });

  it("loads a plain JSON file", async () => {
    const snapshot = await loadSnapshotFile(new File([AW], "aw.snapshot.json"));
    expect(snapshot.source.database).toBe("AdventureWorks2022");
  });

  it("loads a gzipped file, detected by content rather than name", async () => {
    const gz = new File([new Uint8Array(gzipSync(AW))], "renamed.json");
    const snapshot = await loadSnapshotFile(gz);
    expect(snapshot.tables).toHaveLength(71);
  });

  it("reports a corrupt gzip stream clearly", async () => {
    const bad = new File([new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 1, 2, 3])], "x.json.gz");
    expect((await asyncFailure(() => loadSnapshotFile(bad))).kind).toBe("unreadable_file");
  });

  it("reports non-UTF-8 content as invalid JSON", async () => {
    const bad = new File([new Uint8Array([0xff, 0xfe, 0x00])], "x.json");
    expect((await asyncFailure(() => loadSnapshotFile(bad))).kind).toBe("invalid_json");
  });
});

describe("version rule", () => {
  it.each(["1.0", "1.9", "1.12"])("accepts %s", (version) => {
    expect(parseSnapshot(withVersion(version)).format_version).toBe(version);
  });

  it("refuses 2.0 naming found and supported versions", () => {
    const error = failure(() => parseSnapshot(withVersion("2.0")));
    expect(error.kind).toBe("unsupported_version");
    expect(error.message).toContain("2.0");
    expect(error.message).toContain("1.x");
  });

  it("refuses a major-2 file before looking at its structure", () => {
    const error = failure(() =>
      parseSnapshot(JSON.stringify({ format_version: "2.0", tables: 5 })),
    );
    expect(error.kind).toBe("unsupported_version");
  });

  it("refuses a missing version", () => {
    expect(failure(() => parseSnapshot(withVersion(undefined))).kind).toBe("missing_version");
  });

  it.each([["1"], [1.5], ["one.zero"], [null]])("refuses malformed version %j", (version) => {
    expect(failure(() => parseSnapshot(withVersion(version))).kind).toBe("unsupported_version");
  });
});

describe("invalid input", () => {
  it("names invalid JSON", () => {
    const error = failure(() => parseSnapshot("{not json"));
    expect(error.kind).toBe("invalid_json");
    expect(error.message).toContain("not valid JSON");
  });

  it.each(["[]", "42", "null"])("refuses JSON that is not an object (%s)", (text) => {
    expect(failure(() => parseSnapshot(text)).kind).toBe("schema_violation");
  });

  it("reports schema violations with paths", () => {
    const doc = JSON.parse(BIN2) as { tables: { name: unknown }[] };
    const first = doc.tables[0];
    if (first === undefined) {
      throw new Error("fixture has no tables");
    }
    first.name = 7;
    const error = failure(() => parseSnapshot(JSON.stringify(doc)));
    expect(error.kind).toBe("schema_violation");
    expect(error.details.some((line) => line.startsWith("/tables/0/name:"))).toBe(true);
  });

  it("reports a missing required property", () => {
    const doc = JSON.parse(BIN2) as Record<string, unknown>;
    delete doc["source"];
    const error = failure(() => parseSnapshot(JSON.stringify(doc)));
    expect(error.details.join("\n")).toContain("source");
  });

  it("limits the violations shown and counts the rest", () => {
    const doc = JSON.parse(BIN2) as { tables: { name: unknown }[] };
    for (const table of doc.tables) {
      table.name = 1;
    }
    const doc2 = { ...doc, views: [{}, {}, {}, {}] };
    const error = failure(() => parseSnapshot(JSON.stringify(doc2)));
    expect(error.details).toHaveLength(MAX_REPORTED_VIOLATIONS + 1);
    expect(error.details.at(-1)).toMatch(/^and \d+ more$/);
  });
});

describe("WideWorldImporters fixture", () => {
  it("validates with the viewer validator and indexes every table", () => {
    const snapshot = parseSnapshot(WWI);
    expect(snapshot.source.database).toBe("WideWorldImporters");
    expect(snapshot.tables).toHaveLength(48);
    const index = buildIndexes(snapshot);
    for (const table of snapshot.tables ?? []) {
      expect(index.byId(table.id)?.kind).toBe("table");
    }
  });
});

describe("indexes on AdventureWorks", () => {
  const snapshot = parseSnapshot(AW);
  const index = buildIndexes(snapshot);

  it("finds every table, view and routine by id and by exact name", () => {
    for (const table of snapshot.tables ?? []) {
      const byId = index.byId(table.id);
      expect(byId?.kind).toBe("table");
      const schema = index.byId(table.schema_id);
      if (schema?.kind !== "schema") {
        throw new Error(`missing schema ${table.schema_id}`);
      }
      expect(index.byName(schema.item.name, table.name)?.id).toBe(table.id);
    }
    expect(index.byName("HumanResources", "Employee")?.kind).toBe("table");
    expect(index.byName("HumanResources", "vEmployee")?.kind).toBe("view");
    expect(index.byName("HumanResources", "employee")).toBeUndefined();
  });

  it("looks up columns by id with their owner", () => {
    const column = index.byId("column:HumanResources.Department.DepartmentID");
    expect(column?.kind === "column" && column.parentId).toBe("object:HumanResources.Department");
  });

  it("looks up case-insensitively", () => {
    expect(index.byNameIgnoreCase("humanresources", "EMPLOYEE").map((e) => e.id)).toEqual([
      "object:HumanResources.Employee",
    ]);
    expect(index.byNameIgnoreCase("dbo", "nothing")).toEqual([]);
  });

  it("has adjacency counts equal to the relationship and dependency counts", () => {
    const objectIds = [
      ...(snapshot.tables ?? []),
      ...(snapshot.views ?? []),
      ...(snapshot.routines ?? []),
      ...(snapshot.synonyms ?? []),
    ].map((o) => o.id);
    const sum = (count: (id: string) => number): number =>
      objectIds.reduce((total, id) => total + count(id), 0);

    const relationships = snapshot.relationships ?? [];
    expect(relationships.length).toBeGreaterThan(0);
    expect(sum((id) => index.outgoingRelationships(id).length)).toBe(relationships.length);
    expect(sum((id) => index.incomingRelationships(id).length)).toBe(relationships.length);

    const dependencies = snapshot.dependencies ?? [];
    expect(dependencies.length).toBeGreaterThan(0);
    expect(sum((id) => index.outgoingDependencies(id).length)).toBe(dependencies.length);
    const resolved = dependencies.filter((d) => d.target.resolved != null).length;
    expect(sum((id) => index.incomingDependencies(id).length)).toBe(resolved);
  });

  it("returns empty lists for unknown ids", () => {
    expect(index.outgoingRelationships("object:none")).toEqual([]);
    expect(index.byId("object:none")).toBeUndefined();
    expect(index.duplicateIds).toEqual([]);
  });
});

describe("indexes on the BIN2 edge-case snapshot", () => {
  const snapshot = parseSnapshot(BIN2);
  const index = buildIndexes(snapshot);

  it("indexes case-variant names separately and never overwrites", () => {
    expect(index.byName("dbo", "Orders")?.id).toBe("object:dbo.Orders");
    expect(index.byName("dbo", "orders")?.id).toBe("object:dbo.orders");
    expect(index.byName("SYS", "TABLES")?.id).toBe("object:SYS.TABLES");
    expect(index.byId("column:dbo.Orders.Name")?.kind).toBe("column");
    expect(index.byId("column:dbo.Orders.name")?.kind).toBe("column");
  });

  it("gives every table and column of the real extract a distinct id that resolves", () => {
    const ids = (snapshot.tables ?? []).flatMap((t) => [t.id, ...t.columns.map((c) => c.id)]);
    expect(ids.length).toBeGreaterThanOrEqual(8);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) {
      expect(index.byId(id)).toBeDefined();
    }
    expect(index.duplicateIds).toEqual([]);
  });

  it("returns every case variant from the case-insensitive lookup, in snapshot order", () => {
    expect(index.byNameIgnoreCase("DBO", "ORDERS").map((e) => e.id)).toEqual([
      "object:dbo.Orders",
      "object:dbo.orders",
    ]);
  });

  it("keeps adjacency per variant", () => {
    expect(index.outgoingRelationships("object:dbo.orders")).toHaveLength(1);
    expect(index.outgoingRelationships("object:dbo.Orders")).toHaveLength(0);
    expect(index.incomingRelationships("object:dbo.Orders")).toHaveLength(1);
    expect(index.incomingRelationships("object:dbo.orders")).toHaveLength(0);
    expect(index.incomingDependencies("object:dbo.Orders")).toHaveLength(1);
    expect(index.incomingDependencies("object:dbo.orders")).toHaveLength(1);
    expect(index.outgoingDependencies("object:dbo.UpperProc")).toHaveLength(1);
    expect(index.outgoingDependencies("object:dbo.LowerView")).toHaveLength(1);
  });

  it("keeps the first of duplicate ids and reports the rest", () => {
    const doc = JSON.parse(BIN2) as { tables: { id: string }[] };
    const first = doc.tables[1];
    if (first === undefined) {
      throw new Error("fixture has too few tables");
    }
    doc.tables.push(first);
    const dup = buildIndexes(parseSnapshot(JSON.stringify(doc)));
    expect(dup.duplicateIds).toContain(first.id);
  });
});
