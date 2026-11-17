import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { capabilitiesBody } from "./testing";
import { TOKEN_KEY } from "./token";

// The Gate 1 hostile passwords (cli/tests/test_ui_connection_routes.py).
const HOSTILE_PASSWORDS = [
  "Wr0ng};Database=master;UID=sa;PWD={x",
  "pa;ss word=1",
  "}}}{{{",
  "PWD=leak'\"`$(id)`",
  "pässwörd-日本語-✓-🔑",
  "x};UID={sa};PWD={y",
];
const SERVER = "secret-host.example";
const USER = "svc_reader_user";

const QUERIES = {
  version: "9.8.7",
  queries: [
    { name: "tables", purpose: "Extract: user tables.", sql: "SELECT name FROM sys.tables;\n" },
    {
      name: "foreign_keys",
      purpose: "Extract: declared foreign keys.",
      sql: "SELECT name FROM sys.foreign_keys;\n",
    },
  ],
};

let echoed = "";

function stubFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const json = (value: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(value), { status }));
      if (path === "/api/capabilities") return json(capabilitiesBody("linux"));
      if (path === "/api/connections") return json({ connections: [] });
      if (path === "/api/queries") return json(QUERIES);
      if (path === "/api/connection/test") {
        return json({
          checks: [
            {
              name: "Server reachable",
              status: "ok",
              scope: "server",
              message: "Reached it.",
              fix: null,
              fix_sql: null,
            },
          ],
          connected: true,
          ok: true,
          remembered: false,
        });
      }
      if (path === "/api/databases") {
        // A message that echoes every secret, as an unredacted driver message would.
        return json(
          { error: { code: "connect_failed", message: `Login failed: ${echoed}`, fix: "Retry." } },
          502,
        );
      }
      if (path === "/api/jobs" && init?.method === "POST") {
        return json({ error: { code: "invalid", message: `Refused: ${echoed}`, fix: null } }, 422);
      }
      return json({ error: { message: "Not found." } }, 404);
    }),
  );
}

beforeEach(() => {
  window.sessionStorage.setItem(TOKEN_KEY, "t".repeat(43));
  stubFetch();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

async function ready() {
  render(<App />);
  await screen.findByRole("heading", { name: "Connect to SQL Server" });
}

describe("the queries page", () => {
  it("opens from the Connect card and from the footer, lists the version, and goes back", async () => {
    await ready();
    fireEvent.click(
      screen.getAllByRole("button", { name: "See every query it runs" })[0] as HTMLElement,
    );
    await screen.findByRole("heading", { name: "Queries Schema Map runs" });
    expect(
      screen.getByText(/These are the only queries this version can send\./).textContent,
    ).toContain("none read your tables. Version 9.8.7.");
    expect(screen.getByText("2 queries")).toBeTruthy();
    expect(document.querySelectorAll("pre code")).toHaveLength(2);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "Connect to SQL Server" });
    cleanup();
    await ready();
    const footer = within(screen.getByRole("contentinfo"));
    fireEvent.click(footer.getByRole("button", { name: "See every query it runs" }));
    await screen.findByRole("heading", { name: "Queries Schema Map runs" });
  });

  it("filters by name, purpose and SQL, and says when nothing matches", async () => {
    await ready();
    fireEvent.click(
      screen.getAllByRole("button", { name: "See every query it runs" })[0] as HTMLElement,
    );
    await screen.findByText("2 queries");
    const box = screen.getByRole("searchbox", { name: "Search queries" });
    fireEvent.change(box, { target: { value: "FOREIGN" } });
    expect(screen.getByText("1 of 2 queries")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "tables" })).toBeNull();
    expect(screen.getByRole("heading", { name: "foreign_keys" })).toBeTruthy();
    fireEvent.change(box, { target: { value: "sys.tables" } });
    expect(screen.getByRole("heading", { name: "tables" })).toBeTruthy();
    fireEvent.change(box, { target: { value: "no such thing" } });
    expect(screen.getByText(/No query matches/)).toBeTruthy();
  });

  it("copies one query's SQL exactly", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    await ready();
    fireEvent.click(
      screen.getAllByRole("button", { name: "See every query it runs" })[0] as HTMLElement,
    );
    await screen.findByText("2 queries");
    fireEvent.click(screen.getByRole("button", { name: "Copy foreign_keys query" }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Copied foreign_keys query" }).textContent).toBe(
        "Copied",
      );
    });
    expect(writeText).toHaveBeenCalledWith("SELECT name FROM sys.foreign_keys;\n");
  });

  it("shows the code as text, never as markup", async () => {
    QUERIES.queries[0] = {
      name: "tables",
      purpose: "<img src=x onerror=alert(1)>",
      sql: "SELECT '</code><b>x</b>';",
    };
    await ready();
    fireEvent.click(
      screen.getAllByRole("button", { name: "See every query it runs" })[0] as HTMLElement,
    );
    await screen.findByText("2 queries");
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("code b")).toBeNull();
  });
});

describe("Technical details on failure screens", () => {
  it.each(HOSTILE_PASSWORDS)("never hold the server, user or password (%#)", async (password) => {
    echoed = `${SERVER} ${USER} ${password}`;
    await ready();
    fireEvent.change(screen.getByLabelText("Server"), { target: { value: SERVER } });
    fireEvent.change(screen.getByLabelText("User name"), { target: { value: USER } });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    fireEvent.click(await screen.findByRole("button", { name: /Choose a database/ }));
    await screen.findByRole("heading", { name: "Couldn’t load the list of databases" });
    const details = document.querySelector<HTMLDetailsElement>("details.lc-details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    const text = details?.textContent ?? "";
    expect(text).toContain("Technical details");
    expect(text).toContain("databases");
    expect(text).toContain("connect_failed");
    expect(text).toMatch(/\d{4}-\d\d-\d\d \d\d:\d\d:\d\d UTC/);
    for (const secret of [SERVER, USER, password]) expect(text).not.toContain(secret);
  });
});
