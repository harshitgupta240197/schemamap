import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { SchemaMapSnapshotV1 } from "../generated/snapshot";
import { buildIndexes } from "../snapshot/indexes";
import { parseSnapshot } from "../snapshot/parse";
import { definitionReason, describeObject, formatBytes, formatType } from "./model";

const AW = parseSnapshot(
  readFileSync("../cli/tests/fixtures/adventureworks2022.snapshot.json", "utf8"),
);
const aw = buildIndexes(AW);

function described(id: string) {
  const model = describeObject(aw, id);
  if (model === undefined) {
    throw new Error(`no model for ${id}`);
  }
  return model;
}

describe("a table from the AdventureWorks golden", () => {
  const model = described("object:Sales.SalesOrderHeader");

  it("lists columns in ordinal order with types, nullability, defaults and keys", () => {
    expect(model.qualified).toBe("Sales.SalesOrderHeader");
    expect(model.kindLabel).toBe("Table");
    expect(model.columns[0]?.name).toBe("SalesOrderID");
    expect(model.columns[0]?.identity).toBe(true);
    expect(model.columns[0]?.isPrimaryKey).toBe(true);
    const date = model.columns.find((c) => c.name === "OrderDate");
    expect(date?.defaultText).toBe("(getdate())");
    expect(model.columns.find((c) => c.name === "CustomerID")?.isForeignKey).toBe(true);
    expect(model.columns.find((c) => c.name === "SubTotal")?.type).toBe("money");
    const computed = model.columns.find((c) => c.computed !== null);
    expect(computed).toBeDefined();
  });

  it("has keys, indexes and check constraints", () => {
    expect(model.keyConstraints.some((k) => k.kind === "Primary key")).toBe(true);
    expect(model.indexes.length).toBeGreaterThan(0);
    expect(model.checks.length).toBeGreaterThan(0);
  });

  it("says row count and size are not available when the snapshot has none", () => {
    expect(model.rows).toBe("not available");
    expect(model.size).toBe("not available");
  });

  it("lists outgoing and incoming foreign keys as links to the other table", () => {
    const out = model.outgoingKeys.find((k) => k.name.includes("Customer"));
    expect(out?.other).toMatchObject({ kind: "object", label: "Sales.Customer" });
    expect(out?.onDelete).toBe("no action");
    expect(out?.columns).toBe("CustomerID → CustomerID");
    expect(model.incomingKeys.some((k) => k.other.kind === "object")).toBe(true);
  });

  it("lists dependents and dependencies as links", () => {
    expect(model.usedBy.length).toBeGreaterThan(0);
    expect(model.usedBy.every((l) => l.kind === "object")).toBe(true);
  });

  it("has no definition", () => {
    expect(model.definition).toBeNull();
  });
});

describe("views and routines from the golden", () => {
  it("a view shows its definition and what it reads", () => {
    const view = described("object:HumanResources.vEmployee");
    expect(view.kindLabel).toBe("View");
    expect(view.definition?.status).toBe("available");
    expect(view.definition?.text).toContain("CREATE VIEW");
    expect(view.dependsOn.length).toBeGreaterThan(0);
  });

  it("a trigger names its parent and links to it", () => {
    const trigger = described("object:HumanResources.dEmployee");
    expect(trigger.kindLabel).toBe("Trigger");
    expect(trigger.parent).toMatchObject({ kind: "object", label: "HumanResources.Employee" });
  });

  it("unresolved and column-method references are labelled text, never links", () => {
    const labelled = aw.snapshot.dependencies?.flatMap((dep) =>
      dep.target.resolved == null ? [described(dep.from_object)] : [],
    );
    expect(labelled?.length).toBeGreaterThan(0);
    for (const model of labelled ?? []) {
      const texts = model.dependsOn.filter((l) => l.kind === "text");
      expect(texts.length).toBeGreaterThan(0);
      expect(texts.every((l) => l.what.length > 0 && l.label.length > 0)).toBe(true);
    }
    const method = described("object:HumanResources.vJobCandidate").dependsOn.find(
      (l) => l.what === "Column method",
    );
    expect(method).toMatchObject({ kind: "text", label: "Resume.ref.value" });
  });
});

describe("references that must not become links", () => {
  const snapshot = {
    format_version: "1.0",
    schemas: [{ id: "schema:dbo", name: "dbo" }],
    views: [
      {
        id: "object:dbo.V",
        schema_id: "schema:dbo",
        name: "V",
        columns: [],
        definition_status: "available",
        definition: "SELECT 1",
      },
    ],
    dependencies: [
      {
        from_object: "object:dbo.V",
        target: {
          scope: "cross_database",
          name: { database: "Other", schema_name: "x", name: "T", server: null },
          resolved: null,
        },
      },
      {
        from_object: "object:dbo.V",
        target: {
          scope: "cross_server",
          name: { server: "S", database: "D", schema_name: "x", name: "T" },
          resolved: null,
        },
      },
      {
        from_object: "object:dbo.V",
        target: {
          scope: "local",
          name: { name: "Gone", schema_name: "dbo", database: null, server: null },
          resolved: null,
        },
      },
      {
        from_object: "object:dbo.V",
        target: {
          scope: "local",
          name: { name: "Ghost", schema_name: "dbo", database: null, server: null },
          resolved: "object:dbo.DoesNotExist",
        },
      },
    ],
  } as unknown as SchemaMapSnapshotV1;
  const model = describeObject(buildIndexes(snapshot), "object:dbo.V");

  it("labels cross-database, cross-server and unresolved references", () => {
    const byLabel = Object.fromEntries((model?.dependsOn ?? []).map((l) => [l.label, l]));
    expect(byLabel["Other.x.T"]).toEqual({
      kind: "text",
      label: "Other.x.T",
      what: "Cross-database reference",
    });
    expect(byLabel["S.D.x.T"]?.what).toBe("Cross-server reference");
    expect(byLabel["dbo.Gone"]?.what).toBe("Unresolved reference");
  });

  it("does not link a resolved id that is missing from the snapshot", () => {
    const ghost = model?.dependsOn.find((l) => l.label === "dbo.Ghost");
    expect(ghost).toMatchObject({ kind: "text", what: "Unresolved reference" });
  });
});

describe("row counts", () => {
  it("are shown with a size when present", () => {
    const snapshot = {
      ...AW,
      row_counts: {
        items: [
          { object: "object:Sales.SalesOrderHeader", rows: 31465, reserved_bytes: 7_340_032 },
        ],
      },
    } as SchemaMapSnapshotV1;
    const model = describeObject(buildIndexes(snapshot), "object:Sales.SalesOrderHeader");
    expect(model?.rows).toBe("31,465");
    expect(model?.size).toBe("7.0 MB");
  });
});

describe("definition status", () => {
  it("gives a plain-English reason for every status", () => {
    const statuses = [
      "available",
      "encrypted",
      "not_permitted",
      "not_applicable",
      "omitted",
    ] as const;
    const reasons = statuses.map((s) => definitionReason(s, s === "available"));
    expect(new Set(reasons).size).toBe(statuses.length);
    expect(definitionReason("encrypted", false)).toMatch(/encrypted/);
    expect(definitionReason("not_permitted", false)).toMatch(/VIEW DEFINITION/);
    expect(definitionReason("omitted", false)).toMatch(/left out/);
    expect(definitionReason("available", false)).toMatch(/no text/);
  });

  it("treats an available status with no text as having nothing to show", () => {
    const snapshot = {
      format_version: "1.0",
      schemas: [{ id: "schema:dbo", name: "dbo" }],
      routines: [
        {
          id: "object:dbo.P",
          schema_id: "schema:dbo",
          name: "P",
          kind: "procedure",
          definition_status: "available",
          definition: null,
        },
      ],
    } as unknown as SchemaMapSnapshotV1;
    const model = describeObject(buildIndexes(snapshot), "object:dbo.P");
    expect(model?.definition?.text).toBeNull();
    expect(model?.definition?.reason).toMatch(/no text/);
  });
});

describe("formatting", () => {
  const column = (extra: object) =>
    ({ id: "c", name: "c", ordinal: 1, nullable: true, ...extra }) as Parameters<
      typeof formatType
    >[0];

  it("writes types as DDL does", () => {
    expect(formatType(column({ data_type: "nvarchar", length: 50 }))).toBe("nvarchar(50)");
    expect(formatType(column({ data_type: "varbinary", length: null, is_max: true }))).toBe(
      "varbinary(max)",
    );
    expect(formatType(column({ data_type: "decimal", precision: 8, scale: 2 }))).toBe(
      "decimal(8,2)",
    );
    expect(formatType(column({ data_type: "time", scale: 7 }))).toBe("time(7)");
    expect(formatType(column({ data_type: "int" }))).toBe("int");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 bytes");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(25 * 1024 * 1024)).toBe("25 MB");
  });

  it("returns undefined for things the panel cannot show", () => {
    expect(describeObject(aw, "schema:Sales")).toBeUndefined();
    expect(describeObject(aw, "nope")).toBeUndefined();
  });
});
