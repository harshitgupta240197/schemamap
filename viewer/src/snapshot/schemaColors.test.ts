import { describe, expect, it } from "vitest";
import { assignSchemaColors, SCHEMA_PALETTE_SIZE } from "./schemaColors";

describe("assignSchemaColors", () => {
  it("assigns slots in sorted order, whatever order the names arrive in", () => {
    const a = assignSchemaColors(["Sales", "dbo", "HumanResources", "Person"]);
    const b = assignSchemaColors(["Person", "HumanResources", "Sales", "dbo"]);
    expect([...a]).toEqual([...b]);
    expect([...a.keys()]).toEqual(["HumanResources", "Person", "Sales", "dbo"]);
    expect([...a.values()]).toEqual([0, 1, 2, 3]);
  });

  it("gives each name one slot and wraps after the palette runs out", () => {
    const names = Array.from(
      { length: SCHEMA_PALETTE_SIZE + 2 },
      (_, i) => `s${String(i).padStart(2, "0")}`,
    );
    const colors = assignSchemaColors([...names, ...names]);
    expect(colors.size).toBe(names.length);
    expect(colors.get("s00")).toBe(0);
    expect(colors.get(`s${String(SCHEMA_PALETTE_SIZE).padStart(2, "0")}`)).toBe(0);
  });
});
