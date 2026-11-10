import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { INLINE_DATA_ID } from "./snapshot/load";
import { syntheticSnapshot } from "./testing/synthetic";
import { buildIndexes } from "./snapshot/indexes";
import { clusterTables } from "./view/clusters";

// The canvases need a real browser (React Flow measures the DOM; ELK runs in a worker), and the
// Playwright tests cover them. Here they are plain lists, so the App's wiring can be tested.
vi.mock("./graph/OverviewCanvas", async () => {
  const { buildOverviewGraph } = await import("./graph/overview");
  return {
    OverviewCanvas: ({
      clustering,
      schemas,
      onDrill,
    }: {
      clustering: Parameters<typeof buildOverviewGraph>[0];
      schemas: readonly string[];
      onDrill: (id: string) => void;
    }) => (
      <ul aria-label="Overview canvas">
        {buildOverviewGraph(clustering, schemas).nodes.map((node) => (
          <li key={node.id}>
            <button
              type="button"
              onClick={() => {
                onDrill(node.data.clusterId);
              }}
            >
              {node.ariaLabel}
            </button>
          </li>
        ))}
      </ul>
    ),
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

function mount(tables: number): ReturnType<typeof syntheticSnapshot> {
  const snapshot = syntheticSnapshot({ tables, seed: 3 });
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
  it("opens a snapshot over the limit as the overview, drills in and comes back", () => {
    const snapshot = mount(250);
    const clustering = clusterTables(buildIndexes(snapshot));
    const first = clustering.clusters[0];
    if (first === undefined) {
      throw new Error("no clusters");
    }

    const overview = screen.getByRole("list", { name: "Overview canvas" });
    expect(within(overview).getAllByRole("button")).toHaveLength(clustering.clusters.length);
    expect(
      screen.getByText(`250 tables in ${String(clustering.clusters.length)} clusters`),
    ).toBeDefined();
    expect(crumbs().getByText("Overview").getAttribute("aria-current")).toBe("page");
    expect(window.location.hash).toBe("");

    fireEvent.click(
      within(overview).getByRole("button", {
        name: `Open cluster ${first.name}, ${String(first.tableIds.length)} tables`,
      }),
    );
    const tables = screen.getByRole("list", { name: "Table canvas" });
    expect(
      within(tables)
        .getAllByRole("listitem")
        .map((li) => li.textContent),
    ).toEqual([...first.tableIds]);
    expect(crumbs().getByText(first.name).getAttribute("aria-current")).toBe("page");
    expect(window.location.hash).toBe(`#cluster=${encodeURIComponent(first.id)}`);
    expect(screen.getByText(`${String(first.tableIds.length)} of 250 tables`)).toBeDefined();

    fireEvent.click(crumbs().getByRole("button", { name: "Overview" }));
    expect(screen.getByRole("list", { name: "Overview canvas" })).toBeDefined();
    expect(window.location.hash).toBe("");
  });

  it("search for a table on the overview drills into its cluster, selects and centres it", () => {
    const snapshot = mount(250);
    const clustering = clusterTables(buildIndexes(snapshot));
    const target = clustering.clusters[2];
    const tableId = target?.tableIds[0] ?? "";
    const table = (snapshot.tables ?? []).find((t) => t.id === tableId);
    if (target === undefined || table === undefined) {
      throw new Error("no target table");
    }

    fireEvent.click(screen.getByRole("button", { name: /Search/ }));
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: table.name } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(window.location.hash).toBe(
      `#cluster=${encodeURIComponent(target.id)}&select=${encodeURIComponent(tableId)}`,
    );
    const tables = screen.getByRole("list", { name: "Table canvas" });
    expect(tables.dataset.center).toBe(tableId);
    expect(within(tables).getByText(tableId)).toBeDefined();
    expect(
      screen.getByRole("heading", { name: `${table.schema_id.slice(7)}.${table.name}` }),
    ).toBeDefined();

    // Focus from the cluster, then the breadcrumb leads back to the cluster.
    fireEvent.click(
      screen.getByRole("button", { name: `Focus on ${table.schema_id.slice(7)}.${table.name}` }),
    );
    expect(window.location.hash).toContain(`focus=${encodeURIComponent(tableId)}`);
    fireEvent.click(crumbs().getByRole("button", { name: target.name }));
    expect(window.location.hash).toBe(
      `#cluster=${encodeURIComponent(target.id)}&select=${encodeURIComponent(tableId)}`,
    );
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
