import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { TOKEN_KEY } from "./token";
import { capabilitiesBody } from "./testing";

interface Stub {
  os?: "windows" | "macos" | "linux";
  remembered?: unknown[];
  test?: unknown;
  testStatus?: number;
  databases?: unknown;
  databasesStatus?: number;
}

const GREEN = {
  checks: [
    { name: "Server reachable", status: "ok", message: "Reached it.", fix: null, fix_sql: null },
    {
      name: "Can see definitions",
      status: "fail",
      message: "No VIEW DEFINITION.",
      fix: "Ask a DBA.",
      fix_sql: "GRANT VIEW DEFINITION TO [reader];",
    },
    {
      name: "Certificate",
      status: "warn",
      message: "Not verified.",
      fix: "Fine here.",
      fix_sql: null,
    },
  ],
  connected: true,
  ok: false,
  remembered: false,
};

let calls: { path: string; method: string; body: unknown }[] = [];

function stubFetch(stub: Stub): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ path, method: init?.method ?? "GET", body });
      const json = (value: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(value), { status }));
      if (path === "/api/capabilities") return json(capabilitiesBody(stub.os ?? "linux"));
      if (path === "/api/connections" && init?.method === "GET") {
        return json({ connections: stub.remembered ?? [] });
      }
      if (path.startsWith("/api/connections/")) return json({ deleted: true });
      if (path === "/api/connection/test") return json(stub.test ?? GREEN, stub.testStatus ?? 200);
      if (path === "/api/databases") {
        return json(
          stub.databases ?? { databases: [{ name: "AdventureWorks2022" }, { name: "Sales" }] },
          stub.databasesStatus ?? 200,
        );
      }
      return json({ error: { message: "Not found." } }, 404);
    }),
  );
}

beforeEach(() => {
  window.sessionStorage.setItem(TOKEN_KEY, "t".repeat(43));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

async function ready(stub: Stub = {}) {
  stubFetch(stub);
  render(<App />);
  await screen.findByRole("heading", { name: "Connect to SQL Server" });
}

function fillAndTest(password = "hunter2") {
  fireEvent.change(screen.getByLabelText("Server"), { target: { value: "db1" } });
  fireEvent.change(screen.getByLabelText("User name"), { target: { value: "reader" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
}

describe("the Connect screen", () => {
  it("trusts the server certificate only when asked", async () => {
    await ready();
    expect(
      screen.getByRole<HTMLInputElement>("checkbox", { name: /Trust server certificate/ }).checked,
    ).toBe(false);
    expect(screen.queryByText(/Use this only for a lab/)).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: /Trust server certificate/ }));
    expect(screen.getByText(/Use this only for a lab/)).toBeTruthy();
  });

  it("offers Windows only when the server says it is on Windows", async () => {
    await ready({ os: "linux" });
    expect(screen.queryByRole("radio", { name: "Windows" })).toBeNull();
    cleanup();
    await ready({ os: "windows" });
    expect(screen.getByRole("radio", { name: "Windows" })).toBeTruthy();
  });

  it("lists the Entra methods the API sent and no others", async () => {
    await ready();
    fireEvent.click(screen.getByRole("radio", { name: "Microsoft Entra ID" }));
    const options = within(screen.getByLabelText("Entra method")).getAllByRole("option");
    expect(options.map((option) => option.textContent)).toEqual([
      "Password",
      "Interactive (opens a Microsoft sign-in page)",
      "Integrated (your signed-in account)",
    ]);
  });

  it("shows and hides the password with aria-pressed", async () => {
    await ready();
    const field = screen.getByLabelText<HTMLInputElement>("Password");
    const toggle = screen.getByRole("button", { name: "Show password" });
    expect(field.type).toBe("password");
    expect(toggle.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toggle);
    expect(field.type).toBe("text");
    expect(toggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("names what is missing and does not call the server", async () => {
    await ready();
    fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
    expect(screen.getByText("Enter the server name or address.")).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByLabelText("Server"));
    expect(calls.some((call) => call.path === "/api/connection/test")).toBe(false);
  });

  it("keeps Advanced closed by default", async () => {
    await ready();
    expect(document.querySelector("details")?.open).toBe(false);
  });

  it("recent connections show server, method and user, never a password; Use clears it", async () => {
    await ready({
      remembered: [
        {
          id: "a".repeat(32),
          server: "db1",
          port: 14333,
          auth: "sql",
          user: "reader",
          password: "leak",
        },
      ],
    });
    const list = screen.getByRole("list", { name: "Recent connections" });
    expect(list.textContent).toContain("db1, 14333");
    expect(list.textContent).toContain("SQL Server login · reader");
    expect(list.textContent).not.toContain("leak");
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "typed" } });
    fireEvent.click(screen.getByRole("button", { name: "Use db1, 14333" }));
    expect(screen.getByLabelText<HTMLInputElement>("Server").value).toBe("db1");
    expect(screen.getByLabelText<HTMLInputElement>("Port").value).toBe("14333");
    expect(screen.getByLabelText<HTMLInputElement>("Password").value).toBe("");
  });

  it("Forget removes the entry after the server deletes it", async () => {
    await ready({
      remembered: [{ id: "a".repeat(32), server: "db1", port: 1433, auth: "sql", user: "r" }],
    });
    fireEvent.click(screen.getByRole("button", { name: "Forget db1, 1433" }));
    await waitFor(() => {
      expect(screen.queryByRole("button", { name: "Forget db1, 1433" })).toBeNull();
    });
    expect(calls.at(-1)).toMatchObject({
      method: "DELETE",
      path: `/api/connections/${"a".repeat(32)}`,
    });
  });
});

describe("Check and Pick", () => {
  it("shows fail, warn, pass in that order, each with a status word, and a script to copy", async () => {
    await ready();
    fillAndTest();
    await screen.findByRole("heading", { name: "Connection checks" });
    await screen.findByText("No VIEW DEFINITION.");
    const items = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(items).toEqual(["Can see definitions", "Certificate", "Server reachable"]);
    expect(screen.getByText("Needs fixing")).toBeTruthy();
    expect(screen.getByText("Warning")).toBeTruthy();
    expect(screen.getByText("Pass")).toBeTruthy();
    expect(screen.getByText("GRANT VIEW DEFINITION TO [reader];")).toBeTruthy();
    const sent = calls.find((call) => call.path === "/api/connection/test");
    expect(sent?.body).toMatchObject({
      connection: {
        server: "db1",
        auth: "sql",
        user: "reader",
        password: "hunter2",
        trust_server_certificate: false,
      },
      remember: false,
    });
  });

  it("says Copied in a live region after Copy", async () => {
    await ready();
    const writeText = vi.fn(() => Promise.resolve());
    vi.stubGlobal("navigator", { clipboard: { writeText } });
    fillAndTest();
    fireEvent.click(await screen.findByRole("button", { name: "Copy script" }));
    await screen.findByRole("button", { name: "Copied" });
    expect(writeText).toHaveBeenCalledWith("GRANT VIEW DEFINITION TO [reader];");
    expect(screen.getByText("Script copied to the clipboard").closest("[aria-live]")).toBeTruthy();
  });

  it("says so, and shows the fallback, when the clipboard refuses", async () => {
    await ready();
    vi.stubGlobal("navigator", {
      clipboard: { writeText: () => Promise.reject(new Error("denied")) },
    });
    fillAndTest();
    fireEvent.click(await screen.findByRole("button", { name: "Copy script" }));
    await screen.findByText("Could not copy. Select the script above and copy it by hand.");
    expect(screen.getByRole("button", { name: "Copy script" })).toBeTruthy();
  });

  it("Edit connection keeps what was typed", async () => {
    await ready();
    fillAndTest();
    fireEvent.click(await screen.findByRole("button", { name: "Edit connection" }));
    expect(screen.getByLabelText<HTMLInputElement>("Server").value).toBe("db1");
  });

  it("shows a failed check run as an alert with the fix", async () => {
    await ready({
      testStatus: 422,
      test: { error: { message: "That mode is not known.", fix: "Pick another." } },
    });
    fillAndTest();
    await screen.findByText("That mode is not known.");
    expect(screen.getByText("Pick another.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Check again" })).toBeTruthy();
  });

  it("lists databases, filters by search, and shows the no-results state", async () => {
    await ready();
    fillAndTest();
    fireEvent.click(await screen.findByRole("button", { name: "Choose a database anyway" }));
    await screen.findByRole("radio", { name: /AdventureWorks2022/ });
    expect(screen.getByText("2 databases")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Search databases"), { target: { value: "adv" } });
    expect(screen.getByText("1 of 2 databases")).toBeTruthy();
    expect(screen.queryByRole("radio", { name: /Sales/ })).toBeNull();
    fireEvent.change(screen.getByLabelText("Search databases"), { target: { value: "zzz" } });
    expect(screen.getByText("No database matches “zzz”.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    fireEvent.click(screen.getByRole("radio", { name: /Sales/ }));
    expect(screen.getByText("Sales selected")).toBeTruthy();
  });

  it("asks the server again for system databases", async () => {
    await ready();
    fillAndTest();
    fireEvent.click(await screen.findByRole("button", { name: "Choose a database anyway" }));
    await screen.findByRole("radio", { name: /Sales/ });
    fireEvent.click(screen.getByRole("checkbox", { name: "Show system databases" }));
    await screen.findByRole("radio", { name: /Sales/ });
    const bodies = calls.filter((call) => call.path === "/api/databases").map((call) => call.body);
    expect(bodies.map((body) => (body as { include_system: boolean }).include_system)).toEqual([
      false,
      true,
    ]);
  });

  it("shows the empty state with a script for the login", async () => {
    await ready({ databases: { databases: [] } });
    fillAndTest();
    fireEvent.click(await screen.findByRole("button", { name: "Choose a database anyway" }));
    await screen.findByText("This login can’t open any databases yet");
    expect(screen.getByText(/CREATE USER \[reader\] FOR LOGIN \[reader\];/)).toBeTruthy();
  });

  it("shows the error state with the server's message and fix as text", async () => {
    await ready({
      databasesStatus: 502,
      databases: { error: { message: "Timed out <b>after</b> 15 s.", fix: "Raise the timeout." } },
    });
    fillAndTest();
    fireEvent.click(await screen.findByRole("button", { name: "Choose a database anyway" }));
    await screen.findByText("Couldn’t load the list of databases");
    expect(screen.getByText("Timed out <b>after</b> 15 s.")).toBeTruthy();
    expect(document.querySelector("b")).toBeNull();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });
});

describe("starting up", () => {
  it("says how to get a link when there is no session", async () => {
    window.sessionStorage.clear();
    stubFetch({});
    render(<App />);
    expect((await screen.findByRole("status")).textContent).toContain(
      "needs the link printed by schemamap ui",
    );
  });

  it("explains a server that sent no usable capabilities", async () => {
    stubFetch({});
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(new Response("{}", { status: 200 }))),
    );
    render(<App />);
    expect((await screen.findByRole("status")).textContent).toContain("does not understand");
  });
});
