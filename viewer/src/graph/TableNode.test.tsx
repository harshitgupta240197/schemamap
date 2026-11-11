import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ReactFlowProvider } from "@xyflow/react";
import { useMemo } from "react";
import { afterEach, describe, expect, it } from "vitest";
import type { SchemaMapSnapshotV1 } from "../generated/snapshot";
import { buildIndexes } from "../snapshot/indexes";
import { buildGraph } from "./build";
import { ToggleExpandedContext, useExpanded } from "./expanded";
import { TableNode } from "./TableNode";

const HOSTILE = `</script><img src=x onerror="alert(1)">`;

/** A two-table snapshot: Child.ParentId -> Parent.Id, plus one non-key column on each. */
function snapshot(childName: string): SchemaMapSnapshotV1 {
  const col = (table: string, name: string, ordinal: number) => ({
    id: `column:dbo.${table}.${name}`,
    name,
    ordinal,
    data_type: "int",
    nullable: false,
  });
  const pk = (table: string, column: string) => [
    {
      id: `constraint:dbo.PK_${table}`,
      name: `PK_${table}`,
      kind: "primary_key",
      columns: [`column:dbo.${table}.${column}`],
      index: `index:dbo.${table}.PK_${table}`,
    },
  ];
  return {
    format_version: "1.0",
    schemas: [{ id: "schema:dbo", name: "dbo" }],
    tables: [
      {
        id: "object:dbo.Child",
        schema_id: "schema:dbo",
        name: childName,
        columns: [col("Child", "Id", 1), col("Child", "ParentId", 2), col("Child", "Note", 3)],
        key_constraints: pk("Child", "Id"),
      },
      {
        id: "object:dbo.Parent",
        schema_id: "schema:dbo",
        name: "Parent",
        columns: [col("Parent", "Id", 1), col("Parent", "Label", 2)],
        key_constraints: pk("Parent", "Id"),
      },
    ],
    relationships: [
      {
        id: "foreign_key:dbo.FK_Child_Parent",
        name: "FK_Child_Parent",
        edge: "edge:dbo.Child(ParentId)>dbo.Parent(Id)",
        from_object: "object:dbo.Child",
        from_columns: ["column:dbo.Child.ParentId"],
        to_object: "object:dbo.Parent",
        to_columns: ["column:dbo.Parent.Id"],
      },
    ],
  } as unknown as SchemaMapSnapshotV1;
}

/** Renders the Child node with live expand state, as the canvas does. */
function Harness({ childName }: { childName: string }) {
  const [expanded, toggle] = useExpanded();
  const indexes = useMemo(() => buildIndexes(snapshot(childName)), [childName]);
  const node = buildGraph(indexes, expanded).nodes.find(
    (n) => n.data.objectId === "object:dbo.Child",
  );
  if (node === undefined) {
    throw new Error("missing node");
  }
  return (
    <ReactFlowProvider>
      <ToggleExpandedContext.Provider value={toggle}>
        <TableNode
          id={node.id}
          type="table"
          data={node.data}
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
      </ToggleExpandedContext.Provider>
    </ReactFlowProvider>
  );
}

describe("TableNode", () => {
  afterEach(cleanup);

  it("shows name, schema badge, key columns and column count", () => {
    render(<Harness childName="Child" />);
    expect(screen.getByText("Child")).toBeDefined();
    expect(screen.getByText("dbo")).toBeDefined();
    expect(screen.getByText("3 columns")).toBeDefined();
    expect(screen.getByText("Id")).toBeDefined();
    expect(screen.getByText("ParentId")).toBeDefined();
    expect(screen.queryByText("Note")).toBeNull();
  });

  it("expands to every column and collapses back", () => {
    render(<Harness childName="Child" />);
    const button = screen.getByRole("button", { name: "Show all columns of dbo.Child" });
    expect(button.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(button);
    expect(screen.getByText("Note")).toBeDefined();
    const less = screen.getByRole("button", { name: "Show key columns only for dbo.Child" });
    expect(less.getAttribute("aria-expanded")).toBe("true");
    fireEvent.click(less);
    expect(screen.queryByText("Note")).toBeNull();
  });

  it("renders a hostile name as text, never as HTML", () => {
    const { container } = render(<Harness childName={HOSTILE} />);
    expect(screen.getByText(HOSTILE)).toBeDefined();
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
  });
});
