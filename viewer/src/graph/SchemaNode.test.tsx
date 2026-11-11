import { cleanup, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { afterEach, describe, expect, it } from "vitest";
import { indexesOf, makeSnapshot, type LinkSpec, type TableSpec } from "../testing/snapshots";
import { clusterTables } from "../view/clusters";
import { foldSchemas } from "../view/schemaGroups";
import { buildSchemaOverviewGraph } from "./overview";
import { SchemaNode } from "./SchemaNode";
import { ZoomBucketContext } from "./zoom";

const HOSTILE = `</script><img src=x onerror="alert(1)">`;

/** A schema with a hostile name: a 4-table cluster whose hub is hostile, and two small pairs. */
function node() {
  const tables: TableSpec[] = [
    [HOSTILE, HOSTILE, ["Id"]],
    [HOSTILE, "B", ["Id"]],
    [HOSTILE, "C", ["Id"]],
    [HOSTILE, "D", ["Id"]],
    [HOSTILE, "P1", ["Id"]],
    [HOSTILE, "P2", ["Id"]],
    [HOSTILE, "Q1", ["Id"]],
    [HOSTILE, "Q2", ["Id"]],
  ];
  const links: LinkSpec[] = [
    [`${HOSTILE}.B`, `${HOSTILE}.${HOSTILE}`],
    [`${HOSTILE}.C`, `${HOSTILE}.${HOSTILE}`],
    [`${HOSTILE}.D`, `${HOSTILE}.${HOSTILE}`],
    [`${HOSTILE}.P2`, `${HOSTILE}.P1`],
    [`${HOSTILE}.Q2`, `${HOSTILE}.Q1`],
  ];
  const clustering = clusterTables(indexesOf(makeSnapshot(tables, links)));
  const first = buildSchemaOverviewGraph(foldSchemas(clustering), clustering, []).nodes[0];
  if (first === undefined) {
    throw new Error("no schema node");
  }
  return first;
}

function renderAt(bucket: number) {
  const n = node();
  return render(
    <ReactFlowProvider>
      <ZoomBucketContext.Provider value={bucket}>
        <SchemaNode
          id={n.id}
          type="schema"
          data={n.data}
          selected={false}
          dragging={false}
          draggable={false}
          selectable={false}
          deletable={false}
          zIndex={0}
          isConnectable={false}
          positionAbsoluteX={0}
          positionAbsoluteY={0}
        />
      </ZoomBucketContext.Provider>
    </ReactFlowProvider>,
  );
}

describe("SchemaNode", () => {
  afterEach(cleanup);

  it("shows the schema name, counts and tiles, every name as text", () => {
    const { container } = renderAt(1);
    // Too long for the header at full size: cut in the middle, whole in the title and hidden text.
    const name = container.querySelector(".sm-schema__name");
    expect(name?.getAttribute("title")).toBe(HOSTILE);
    expect(name?.querySelector(".sm-visually-hidden")?.textContent).toBe(HOSTILE);
    const shown = name?.querySelector(".sm-label__line")?.textContent ?? "";
    expect(shown).toContain("…");
    expect(HOSTILE.startsWith(shown.split("…")[0] ?? "x")).toBe(true);
    expect(HOSTILE.endsWith(shown.split("…")[1] ?? "x")).toBe(true);
    expect(screen.getByText("8 tables · 3 clusters")).toBeDefined();
    const tiles = [...container.querySelectorAll(".sm-schema__tile")];
    expect(tiles.map((tile) => [tile.getAttribute("data-kind"), tile.textContent])).toEqual([
      ["cluster", `${HOSTILE}4`],
      ["group", "Small groups4"],
    ]);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });

  it("hides the tiles from assistive technology", () => {
    const { container } = renderAt(1);
    expect(container.querySelector(".sm-schema__tiles")?.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the count when compact while the header is tall enough, and drops it below", () => {
    renderAt(0.3);
    expect(screen.getByText("8 tables · 3 clusters")).toBeDefined();
    cleanup();
    renderAt(0.1);
    expect(screen.queryByText("8 tables · 3 clusters")).toBeNull();
  });
});
