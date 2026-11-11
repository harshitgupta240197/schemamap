import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { indexesOf, makeSnapshot } from "../testing/snapshots";
import { Palette, useSearchShortcut } from "./Palette";
import { buildSearchItems } from "./searchIndex";

afterEach(cleanup);

const HOSTILE = `<img src=x onerror="alert(1)">`;
const items = buildSearchItems(
  indexesOf(
    makeSnapshot([
      ["dbo", "Order", ["Id"]],
      ["dbo", "order", ["Id"]],
      ["dbo", HOSTILE, ["Id"]],
    ]),
  ),
);

function setup() {
  const onSelect = vi.fn();
  const onClose = vi.fn();
  render(<Palette items={items} onSelect={onSelect} onClose={onClose} />);
  const box = screen.getByRole("combobox");
  return { box, onSelect, onClose };
}

describe("Palette", () => {
  it("is a combobox over a listbox with the active option referenced", () => {
    const { box } = setup();
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute("aria-expanded")).toBe("false");
    fireEvent.change(box, { target: { value: "order" } });
    expect(box.getAttribute("aria-expanded")).toBe("true");
    const options = screen.getAllByRole("option");
    expect(options.map((o) => o.getAttribute("aria-selected"))).toEqual(
      options.map((_, i) => String(i === 0)),
    );
    expect(box.getAttribute("aria-activedescendant")).toBe(options[0]?.id);
    expect(box.getAttribute("aria-controls")).toBe(screen.getByRole("listbox").id);
  });

  it("lists both case variants with their schema, moves with arrows and selects with Enter", () => {
    const { box, onSelect } = setup();
    fireEvent.change(box, { target: { value: "order" } });
    const tables = screen.getAllByRole("option").filter((o) => o.textContent.startsWith("Table"));
    expect(tables.map((o) => o.textContent)).toEqual(["TableOrderdbo", "Tableorderdbo"]);
    fireEvent.keyDown(box, { key: "ArrowDown" });
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSelect).toHaveBeenCalledTimes(1);
    const [chosen] = onSelect.mock.calls[0] as [{ id: string }];
    expect(chosen.id).toBe("object:dbo.order");
  });

  it("closes on Escape and renders hostile names as text", () => {
    const { box, onClose } = setup();
    fireEvent.change(box, { target: { value: "onerror" } });
    expect(document.querySelector("img")).toBeNull();
    expect(screen.getAllByRole("option")[0]?.textContent).toContain(HOSTILE);
    fireEvent.keyDown(box, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("useSearchShortcut", () => {
  function Host({ open }: { open: () => void }) {
    useSearchShortcut(open);
    return <input aria-label="field" />;
  }

  it("opens on / and Ctrl/Cmd+K but not on / inside an input", () => {
    const open = vi.fn();
    render(<Host open={open} />);
    fireEvent.keyDown(document.body, { key: "/" });
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "/" });
    expect(open).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(screen.getByLabelText("field"), { key: "k", ctrlKey: true });
    fireEvent.keyDown(document.body, { key: "K", metaKey: true });
    expect(open).toHaveBeenCalledTimes(3);
  });

  it("does not take / with a modifier", () => {
    const open = vi.fn();
    render(<Host open={open} />);
    fireEvent.keyDown(document.body, { key: "/", ctrlKey: true });
    expect(open).not.toHaveBeenCalled();
  });
});
