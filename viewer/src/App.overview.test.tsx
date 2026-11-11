import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { INLINE_DATA_ID } from "./snapshot/load";
import { syntheticSnapshot } from "./testing/synthetic";
import { buildIndexes } from "./snapshot/indexes";
import { clusterTables } from "./view/clusters";
import { foldSchemas } from "./view/schemaGroups";

// The canvases need a real browser (React Flow measures the DOM; ELK runs in a worker), and the
// Playwright tests cover them. Here they are plain lists, so the App's wiring can be tested.
vi.mock("./graph/OverviewCanvas", async () => {
  const { buildSchemaLevelGraph, buildSchemaOverviewGraph } = await import("./graph/overview");
  type Folding = Parameters<typeof buildSchemaOverviewGraph>[0];
  type Clustering = Parameters<typeof buildSchemaOverviewGraph>[1];
  type Target = { kind: "schema" | "cluster" | "group"; id: string };
  return {
    OverviewCanvas: ({
      clustering,
      folding,
      schema,
      schemas,
      onDrill,
    }: {
      clustering: Clustering;
      folding: Folding;
      schema: string | null;
      schemas: readonly string[];
      onDrill: (target: Target) => void;
    }) => {
      const items: { id: string; label: string; target: Target }[] =
        schema === null
          ? buildSchemaOverviewGraph(folding, clustering, schemas).nodes.map((node) => ({
              id: node.id,
              label: node.ariaLabel ?? "",
              target: { kind: "schema", id: node.data.schemaId },
            }))
          : buildSchemaLevelGraph(folding, clustering, schema).nodes.map((node) => ({
              id: node.id,
              label: node.ariaLabel ?? "",
              target: { kind: node.data.targetKind, id: node.data.targetId },
            }));
      return (
        <ul aria-label="Overview canvas">
          {items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => {
                  onDrill(item.target);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      );
    },
  };
});
vi.mock("./graph/GraphCanvas", () => ({
  GraphCanvas: ({
    visible,
    centerOn,
  }: {
    visible: ReadonlySet<string> | null;
    centerOn: string | null;
  }) => (
    <ul aria-label="Table canvas" data-center={centerOn ?? ""}>
      {visible === null ? (
        <li>every table</li>
      ) : (
        [...visible].sort().map((id) => <li key={id}>{id}</li>)
      )}
    </ul>
  ),
}));

function mount(
  tables: number,
  shape: "dense" | "sparse" = "dense",
): ReturnType<typeof syntheticSnapshot> {
  const snapshot = syntheticSnapshot({ tables, seed: 3, shape });
  const script = document.createElement("script");
  script.type = "application/json";
  script.id = INLINE_DATA_ID;
  script.textContent = JSON.stringify(snapshot);
  document.body.append(script);
  render(<App />);
  return snapshot;
}

afterEach(() => {
  cleanup();
  document.getElementById(INLINE_DATA_ID)?.remove();
  window.history.replaceState(null, "", "/");
});

const crumbs = () => within(screen.getByRole("navigation", { name: "Breadcrumb" }));

describe("overview mode", () => {
  it("opens a snapshot over the limit on the schema overview, drills into a schema and back", () => {
    const snapshot = mount(250);
    const folding = foldSchemas(clusterTables(buildIndexes(snapshot)));
    const sales = folding.schemaById.get("schema:Sales");
    if (sales === undefined) {
      throw new Error("no Sales schema");
    }

    const overview = screen.getByRole("list", { name: "Overview canvas" });
    expect(within(overview).getAllByRole("button")).toHaveLength(folding.schemas.length);
    expect(
      screen.getByText(`250 tables in ${String(folding.schemas.length)} schemas`),
    ).toBeDefined();
    expect(crumbs().getByText("Overview").getAttribute("aria-current")).toBe("page");
    expect(window.location.hash).toBe("");

    // Sales fits one layout, so drilling into it shows its tables.
    fireEvent.click(
      within(overview).getByRole("button", {
        name: `Open schema Sales, ${String(sales.tableCount)} tables`,
      }),
    );
    const tables = screen.getByRole("list", { name: "Table canvas" });
    const salesTables = (snapshot.tables ?? [])
      .filter((t) => t.schema_id === "schema:Sales")
      .map((t) => t.id)
      .sort();
    expect(
      within(tables)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual(salesTables);
    expect(crumbs().getByText("Sales").getAttribute("aria-current")).toBe("page");
    expect(window.location.hash).toBe("#drill=schema%3ASales");
    expect(screen.getByText(`${String(sales.tableCount)} of 250 tables`)).toBeDefined();

    fireEvent.click(crumbs().getByRole("button", { name: "Overview" }));
    expect(screen.getByRole("list", { name: "Overview canvas" })).toBeDefined();
    expect(window.location.hash).toBe("");
  });

  it("drills schema → small groups → back on a large, sparse schema", () => {
    const snapshot = mount(2000, "sparse");
    const folding = foldSchemas(clusterTables(buildIndexes(snapshot)));
    const dbo = folding.schemaById.get("schema:dbo");
    const group = dbo?.smallGroups[0];
    if (dbo === undefined || group === undefined) {
      throw new Error("no dbo small groups");
    }
    fireEvent.click(
      screen.getByRole("button", { name: `Open schema dbo, ${String(dbo.tableCount)} tables` }),
    );
    expect(window.location.hash).toBe("#drill=schema%3Adbo");
    expect(crumbs().getByText("dbo").getAttribute("aria-current")).toBe("page");
    const boxes = screen.getByRole("list", { name: "Overview canvas" });
    expect(within(boxes).getAllByRole("button")).toHaveLength(
      dbo.tiles.length + dbo.smallGroups.length,
    );
    expect(
      screen.getByText(`${String(dbo.tableCount)} tables in ${String(dbo.clusterCount)} clusters`),
    ).toBeDefined();

    fireEvent.click(
      within(boxes).getByRole("button", {
        name: `Open ${group.name}, ${String(group.tableIds.length)} tables in ${String(group.clusterIds.length)} groups`,
      }),
    );
    expect(window.location.hash).toBe(`#group=${encodeURIComponent(group.id)}`);
    const tables = screen.getByRole("list", { name: "Table canvas" });
    expect(within(tables).getAllByRole("listitem")).toHaveLength(group.tableIds.length);
    expect(crumbs().getByText(group.name).getAttribute("aria-current")).toBe("page");

    fireEvent.click(crumbs().getByRole("button", { name: "dbo" }));
    expect(window.location.hash).toBe("#drill=schema%3Adbo");
  });

  it("search for a table on the overview moves to its schema, selects and centres it", () => {
    const snapshot = mount(250);
    const clustering = clusterTables(buildIndexes(snapshot));
    const target = clustering.clusters[2];
    const tableId = target?.tableIds[0] ?? "";
    const table = (snapshot.tables ?? []).find((t) => t.id === tableId);
    if (target === undefined || table === undefined) {
      throw new Error("no target table");
    }
    const schemaName = table.schema_id.slice(7);

    fireEvent.click(screen.getByRole("button", { name: /Search/ }));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: table.name } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(window.location.hash).toBe(
      `#drill=${encodeURIComponent(table.schema_id)}&select=${encodeURIComponent(tableId)}`,
    );
    const tables = screen.getByRole("list", { name: "Table canvas" });
    expect(tables.dataset.center).toBe(tableId);
    expect(within(tables).getByText(tableId)).toBeDefined();
    expect(screen.getByRole("heading", { name: `${schemaName}.${table.name}` })).toBeDefined();

    // Focus from the schema, then the breadcrumb leads back to the schema.
    fireEvent.click(screen.getByRole("button", { name: `Focus on ${schemaName}.${table.name}` }));
    expect(window.location.hash).toContain(`focus=${encodeURIComponent(tableId)}`);
    fireEvent.click(crumbs().getByRole("button", { name: schemaName }));
    expect(window.location.hash).toBe(
      `#drill=${encodeURIComponent(table.schema_id)}&select=${encodeURIComponent(tableId)}`,
    );
  });

  it("restores a small group from the hash", () => {
    const snapshot = syntheticSnapshot({ tables: 2000, seed: 3, shape: "sparse" });
    const folding = foldSchemas(clusterTables(buildIndexes(snapshot)));
    const group = folding.schemas[0]?.smallGroups[0];
    window.history.replaceState(null, "", `/#group=${encodeURIComponent(group?.id ?? "")}`);
    mount(2000, "sparse");
    expect(
      crumbs()
        .getByText(group?.name ?? "")
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(crumbs().getByRole("button", { name: group?.schemaName ?? "" })).toBeDefined();
  });

  it("restores a drilled view from the hash", () => {
    const snapshot = syntheticSnapshot({ tables: 250, seed: 3 });
    const target = clusterTables(buildIndexes(snapshot)).clusters[1];
    window.history.replaceState(null, "", `/#cluster=${encodeURIComponent(target?.id ?? "")}`);
    mount(250);
    expect(
      crumbs()
        .getByText(target?.name ?? "")
        .getAttribute("aria-current"),
    ).toBe("page");
  });

  it("keeps the full map for a snapshot within the limit", () => {
    mount(150);
    expect(screen.getByRole("list", { name: "Table canvas" }).textContent).toBe("every table");
    expect(crumbs().getByText("Full map").getAttribute("aria-current")).toBe("page");
    expect(screen.getByText("150 of 150 tables")).toBeDefined();
  });
});
