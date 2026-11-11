import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { INLINE_DATA_ID } from "./snapshot/load";
import { syntheticSnapshot } from "./testing/synthetic";

// The canvases need a real browser; the Playwright tests cover them.
vi.mock("./graph/GraphCanvas", () => ({ GraphCanvas: () => <div>table canvas</div> }));
vi.mock("./graph/OverviewCanvas", () => ({ OverviewCanvas: () => <div>overview canvas</div> }));

function inline(text: string): void {
  const script = document.createElement("script");
  script.type = "application/json";
  script.id = INLINE_DATA_ID;
  script.textContent = text;
  document.body.append(script);
}

afterEach(() => {
  cleanup();
  document.getElementById(INLINE_DATA_ID)?.remove();
  window.history.replaceState(null, "", "/");
});

describe("page states", () => {
  it("shows a designed empty state with the file picker", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: "Open a snapshot to see the map" })).toBeDefined();
    expect(screen.getByLabelText("Open snapshot")).toBeDefined();
    expect(screen.getByText(/never uploaded/)).toBeDefined();
  });

  it("shows a load error as an alert with a way to try another file", () => {
    inline('{"not":"a snapshot"}');
    render(<App />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getByRole("heading").textContent).toBe(
      "This snapshot could not be opened",
    );
    expect(alert.textContent).toContain("format_version");
    expect(within(alert).getByLabelText("Open another snapshot")).toBeDefined();
  });

  it("says what went wrong in plain English first, with the technical text under Details", () => {
    inline('{"not":"a snapshot"}');
    render(<App />);
    const alert = screen.getByRole("alert");
    const plain = within(alert).getByText("That file does not look like a Schema Map snapshot.");
    const details = alert.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.querySelector("summary")?.textContent).toBe("Details");
    expect(details?.textContent).toContain("format_version");
    expect(details?.contains(plain)).toBe(false);
    expect(plain.textContent).not.toContain("format_version");
    expect(details?.open).toBe(false);
  });

  it("lists the violation paths of an invalid snapshot", () => {
    inline(JSON.stringify({ format_version: "1.0" }));
    render(<App />);
    const alert = screen.getByRole("alert");
    expect(within(alert).getAllByRole("listitem").length).toBeGreaterThan(0);
  });
});

describe("About this map", () => {
  it("names the tool and viewer versions, the extraction time and the read-only note", () => {
    const snapshot = syntheticSnapshot({ tables: 5, seed: 1 });
    inline(JSON.stringify(snapshot));
    render(<App />);
    const footer = screen.getByRole("contentinfo", { name: "About this map" });
    expect(footer.textContent).toContain(`Schema Map ${snapshot.generator.version}`);
    expect(footer.textContent).toContain(`viewer ${__VIEWER_VERSION__}`);
    expect(footer.textContent).toContain("Extracted ");
    expect(footer.textContent).toContain("Read-only: built from metadata, no row data");
  });
});
