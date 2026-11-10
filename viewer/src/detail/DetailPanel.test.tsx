import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DefinitionStatus, SchemaMapSnapshotV1 } from "../generated/snapshot";
import { buildIndexes } from "../snapshot/indexes";
import { HIGHLIGHT_LIMIT } from "../tsql/Definition";
import { DetailPanel } from "./DetailPanel";
import { describeObject } from "./model";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const HOSTILE = `</script><img src=x onerror="alert(1)">`;

function snapshot(
  definition: string | null,
  status: DefinitionStatus,
  name = "V",
): SchemaMapSnapshotV1 {
  return {
    format_version: "1.0",
    schemas: [{ id: "schema:dbo", name: "dbo" }],
    tables: [
      {
        id: "object:dbo.T",
        schema_id: "schema:dbo",
        name: HOSTILE,
        description: HOSTILE,
        columns: [
          {
            id: "column:dbo.T.Id",
            name: HOSTILE,
            ordinal: 1,
            data_type: "int",
            nullable: false,
            default: { id: "d", name: "d", definition: HOSTILE },
          },
        ],
        indexes: [
          {
            id: "index:dbo.T.IX",
            name: HOSTILE,
            kind: "nonclustered",
            unique: false,
            key_columns: [{ column: "column:dbo.T.Id" }],
            included_columns: [],
            filter: HOSTILE,
          },
        ],
      },
    ],
    views: [
      {
        id: "object:dbo.V",
        schema_id: "schema:dbo",
        name,
        columns: [],
        definition_status: status,
        definition,
      },
    ],
    dependencies: [
      {
        from_object: "object:dbo.V",
        target: {
          scope: "local",
          name: { name: "T", schema_name: "dbo" },
          resolved: "object:dbo.T",
        },
      },
    ],
  } as unknown as SchemaMapSnapshotV1;
}

function show(snap: SchemaMapSnapshotV1, id: string, onSelect = vi.fn(), onClose = vi.fn()) {
  const model = describeObject(buildIndexes(snap), id);
  if (model === undefined) {
    throw new Error("no model");
  }
  return render(<DetailPanel model={model} onSelect={onSelect} onClose={onClose} />);
}

describe("DetailPanel", () => {
  it("is a complementary landmark named for the object", () => {
    show(snapshot("SELECT 1", "available"), "object:dbo.V");
    expect(screen.getByRole("complementary", { name: "Details: dbo.V" })).toBeDefined();
  });

  it.each<[DefinitionStatus, RegExp]>([
    ["encrypted", /encrypted/],
    ["not_permitted", /VIEW DEFINITION/],
    ["not_applicable", /no T-SQL definition/],
    ["omitted", /left out/],
  ])("shows the %s status with its reason and no definition", (status, reason) => {
    show(snapshot(null, status), "object:dbo.V");
    expect(document.querySelector(".sm-detail__reason")?.textContent).toMatch(reason);
    expect(document.querySelector(".sm-detail__reason")?.textContent).toMatch(
      status.replace("_", " "),
    );
    expect(screen.queryByLabelText("Definition")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy definition" })).toBeNull();
  });

  it("shows an available definition highlighted", () => {
    show(snapshot("SELECT 1 -- hi", "available"), "object:dbo.V");
    const pre = screen.getByLabelText("Definition");
    expect(pre.textContent).toBe("SELECT 1 -- hi");
    expect(pre.querySelector(".sm-sql__keyword")?.textContent).toBe("SELECT");
    expect(pre.querySelector(".sm-sql__comment")?.textContent).toBe("-- hi");
  });

  it("shows a definition over 200 KB unhighlighted and unchanged", () => {
    const long = `SELECT 1 ${"x".repeat(HIGHLIGHT_LIMIT)}`;
    show(snapshot(long, "available"), "object:dbo.V");
    const pre = screen.getByLabelText("Definition");
    expect(pre.getAttribute("data-highlighted")).toBe("no");
    expect(pre.children.length).toBe(0);
    expect(pre.textContent).toBe(long);
  });

  it("renders hostile names, defaults, filters and definitions as text only", () => {
    const { container } = show(snapshot(HOSTILE, "available", HOSTILE), "object:dbo.T");
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain(`default ${HOSTILE}`);
    expect(container.textContent).toContain(`Filter: ${HOSTILE}`);
    cleanup();
    const view = show(snapshot(HOSTILE, "available", HOSTILE), "object:dbo.V");
    expect(view.container.querySelector("img")).toBeNull();
    expect(screen.getByLabelText("Definition").textContent).toBe(HOSTILE);
  });

  it("clicking a related object selects it", () => {
    const onSelect = vi.fn();
    show(snapshot("SELECT 1", "available"), "object:dbo.V", onSelect);
    fireEvent.click(
      within(screen.getByRole("complementary")).getByRole("button", { name: `dbo.${HOSTILE}` }),
    );
    expect(onSelect).toHaveBeenCalledWith("object:dbo.T");
  });

  it("Close calls onClose", () => {
    const onClose = vi.fn();
    show(snapshot("SELECT 1", "available"), "object:dbo.V", vi.fn(), onClose);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(onClose).toHaveBeenCalled();
  });
});

describe("copy buttons", () => {
  it("copy with the Clipboard API when it works", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    show(snapshot("SELECT 1", "available"), "object:dbo.V");
    fireEvent.click(screen.getByRole("button", { name: "Copy definition" }));
    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeDefined();
    });
    expect(writeText).toHaveBeenCalledWith("SELECT 1");
    fireEvent.click(screen.getByRole("button", { name: "Copy name" }));
    expect(writeText).toHaveBeenCalledWith("dbo.V");
  });

  it("select the text and ask for Ctrl/Cmd+C when the Clipboard API refuses", async () => {
    vi.stubGlobal("navigator", { clipboard: { writeText: () => Promise.reject(new Error("no")) } });
    show(snapshot("SELECT 1", "available"), "object:dbo.V");
    fireEvent.click(screen.getByRole("button", { name: "Copy definition" }));
    await waitFor(() => {
      expect(screen.getByText("Press Ctrl/Cmd+C")).toBeDefined();
    });
    expect(window.getSelection()?.toString()).toBe("SELECT 1");
  });

  it("fall back when there is no Clipboard API at all", () => {
    vi.stubGlobal("navigator", {});
    show(snapshot("SELECT 1", "available"), "object:dbo.V");
    fireEvent.click(screen.getByRole("button", { name: "Copy name" }));
    expect(screen.getByText("Press Ctrl/Cmd+C")).toBeDefined();
    expect(window.getSelection()?.toString()).toBe("dbo.V");
  });
});
