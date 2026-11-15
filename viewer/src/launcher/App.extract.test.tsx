import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { capabilitiesBody } from "./testing";
import { TOKEN_KEY } from "./token";

const JOB = "j".repeat(32);
const MAP = "m".repeat(32);
const OTHER = "o".repeat(32);

const PASSED = {
  checks: [
    {
      name: "VIEW DEFINITION",
      status: "ok",
      scope: "database",
      message: "ok",
      fix: null,
      fix_sql: null,
    },
  ],
  connected: true,
  ok: true,
  remembered: false,
};

const sections = (states: string[], counts: (number | null)[] = []) =>
  ["schemas", "tables", "views"].map((name, index) => ({
    name,
    state: states[index] ?? "pending",
    count: counts[index] ?? null,
  }));

interface Api {
  /** What `GET /api/jobs/<id>` answers next; the last one repeats. */
  jobs: unknown[];
  maps: unknown[];
  importStatus?: number;
  quitStatus?: number;
  /** When set, `POST /api/jobs` answers 409 with this body. */
  refuseStart?: unknown;
}

let api: Api;
let calls: { path: string; method: string; body: unknown }[] = [];

function stub(): void {
  calls = [];
  vi.stubGlobal(
    "fetch",
    vi.fn((path: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
      calls.push({ path, method, body });
      const json = (value: unknown, status = 200) =>
        Promise.resolve(new Response(JSON.stringify(value), { status }));
      if (path === "/api/capabilities") return json(capabilitiesBody("linux"));
      if (path === "/api/connections") return json({ connections: [] });
      if (path === "/api/connection/test") return json(PASSED);
      if (path === "/api/databases")
        return json({ databases: [{ name: "Sales" }, { name: "HR" }] });
      if (path === "/api/jobs")
        return api.refuseStart === undefined
          ? json({ job_id: JOB }, 202)
          : json(api.refuseStart, 409);
      if (path === `/api/jobs/${JOB}`) {
        const next = api.jobs.length > 1 ? api.jobs.shift() : api.jobs[0];
        return json(next);
      }
      if (path === `/api/jobs/${JOB}/cancel`) return json({ state: "cancelling" });
      if (path === "/api/maps" && method === "GET") return json({ maps: api.maps });
      if (path === `/api/maps/${MAP}` && method === "DELETE") {
        api.maps = api.maps.filter((entry) => (entry as { id: string }).id !== MAP);
        return json({ deleted: true });
      }
      if (path === "/api/maps/import") {
        return api.importStatus === undefined
          ? json({ map_id: OTHER })
          : json({ error: { message: "The snapshot is not valid." } }, api.importStatus);
      }
      if (path === "/api/quit") return json({ status: "stopping" }, api.quitStatus ?? 200);
      return json({ error: { message: "Not found." } }, 404);
    }),
  );
}

const entry = (id: string, database: string) => ({
  id,
  database,
  server: "db1",
  extracted_at: new Date().toISOString(),
  tables: 71,
  bytes: 2_516_582,
});

beforeEach(() => {
  window.sessionStorage.setItem(TOKEN_KEY, "t".repeat(43));
  api = { jobs: [], maps: [entry(MAP, "Sales")] };
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

/** Connect, check and pick "Sales" up to the Extract map button. */
async function toPick(): Promise<void> {
  stub();
  render(<App />);
  await screen.findByRole("heading", { name: "Connect to SQL Server" });
  fireEvent.change(screen.getByLabelText("Server"), { target: { value: "db1" } });
  fireEvent.change(screen.getByLabelText("User name"), { target: { value: "reader" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
  fireEvent.click(screen.getByRole("button", { name: "Test connection" }));
  fireEvent.click(await screen.findByRole("button", { name: "Choose a database" }));
  fireEvent.click(await screen.findByRole("radio", { name: /Sales/ }));
}

async function startExtract(): Promise<void> {
  await toPick();
  fireEvent.click(screen.getByRole("button", { name: "Extract map" }));
  await screen.findByRole("heading", { name: "Extracting Sales" });
}

const running = (states: string[]) => ({
  job_id: JOB,
  state: "running",
  sections: sections(states),
  elapsed_ms: 3400,
});

describe("the Extract screen", () => {
  it("starts the job, drops the password, and shows progress without counts", async () => {
    api.jobs = [running(["done", "running", "pending"])];
    await startExtract();
    const started = calls.find((call) => call.path === "/api/jobs");
    expect(started?.body).toMatchObject({
      connection: { database: "Sales", password: "hunter2" },
    });
    const bar = await screen.findByRole("progressbar", { name: "Extract progress" });
    await waitFor(() => {
      expect(bar.getAttribute("aria-valuenow")).toBe("1");
    });
    expect(bar.getAttribute("aria-valuemax")).toBe("3");
    expect(screen.getByText("1 of 3 sections done")).toBeTruthy();
    expect(screen.getByText("Elapsed 0:03")).toBeTruthy();
    const list = screen.getByRole("list", { name: "Sections" });
    expect(within(list).getByText("Reading…")).toBeTruthy();
    expect(within(list).queryByText(/tables ·/)).toBeNull();
  });

  it("shows the counts and the Done screen once the job ends", async () => {
    api.jobs = [
      running(["done", "running", "pending"]),
      {
        job_id: JOB,
        state: "done",
        map_id: MAP,
        sections: sections(["done", "done", "done"], [6, 71, 2]),
        elapsed_ms: 5000,
      },
    ];
    await startExtract();
    await screen.findByRole("heading", { name: "Your map of Sales is ready" }, { timeout: 3000 });
    expect(screen.getByText(/71 tables · db1, 1433/)).toBeTruthy();
    const open = screen.getByRole("link", { name: /Open map/ });
    expect(open.getAttribute("href")).toBe(`/maps/${MAP}`);
    expect(open.getAttribute("target")).toBe("_blank");
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("button", { name: "Save map file" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Extract another database" })).toBeTruthy();
  });

  it("explains a failed extract with the fix, and says nothing was saved", async () => {
    api.jobs = [
      {
        job_id: JOB,
        state: "failed",
        sections: sections(["done", "failed", "pending"]),
        elapsed_ms: 62000,
        error: {
          code: "query_timeout",
          message: "A query ran longer than the 60-second query timeout.",
          fix: "Raise Query timeout under Advanced, then extract again.",
        },
      },
    ];
    await startExtract();
    await screen.findByRole("heading", { name: "The extract stopped at Tables" });
    expect(screen.getByText(/longer than the 60-second/)).toBeTruthy();
    expect(screen.getByText(/Raise Query timeout under Advanced/)).toBeTruthy();
    expect(screen.getByText(/Nothing was saved/)).toBeTruthy();
    expect(screen.getByText("Elapsed 1:02")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();
  });

  it("cancels, comes back to Pick and asks for the password again", async () => {
    api.jobs = [
      running(["running", "pending", "pending"]),
      { job_id: JOB, state: "cancelled", sections: sections([]), elapsed_ms: 900 },
    ];
    await startExtract();
    fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(calls.some((call) => call.path === `/api/jobs/${JOB}/cancel`)).toBe(true);
    await screen.findByRole("heading", { name: "Choose a database" }, { timeout: 3000 });
    expect(screen.getByText("Sales selected")).toBeTruthy();
    const password = screen.getByLabelText("Password");
    expect((password as HTMLInputElement).value).toBe("");
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Extract map" }).disabled).toBe(
      true,
    );
    fireEvent.change(password, { target: { value: "again" } });
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Extract map" }).disabled).toBe(
      false,
    );
  });

  it("shows why a job could not start", async () => {
    await toPick();
    const real = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn((path: string, init?: RequestInit) =>
        path === "/api/jobs"
          ? Promise.resolve(
              new Response(
                JSON.stringify({
                  error: { message: "An extract is already running.", fix: "Wait for it." },
                }),
                { status: 409 },
              ),
            )
          : real(path, init),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Extract map" }));
    await screen.findByText("An extract is already running.");
    expect(screen.getByText(/Wait for it\./)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Try again" })).toBeTruthy();
  });

  it("keeps the password out of the page once the job has started", async () => {
    api.jobs = [running(["running", "pending", "pending"])];
    await startExtract();
    await screen.findByRole("progressbar");
    expect(document.body.innerHTML).not.toContain("hunter2");
    fireEvent.click(screen.getByRole("button", { name: "Recent maps" }));
    fireEvent.click(screen.getByRole("button", { name: "New connection" }));
    await screen.findByRole("heading", { name: "Connect to SQL Server" });
    expect(screen.getByLabelText<HTMLInputElement>("Password").value).toBe("");
  });
});

describe("Recent maps", () => {
  async function toRecent() {
    stub();
    render(<App />);
    await screen.findByRole("heading", { name: "Connect to SQL Server" });
    fireEvent.click(screen.getByRole("button", { name: "Recent maps" }));
    await screen.findByRole("heading", { name: "Recent maps", level: 1 });
  }

  it("lists maps with the facts and an Open link that opens a new tab", async () => {
    await toRecent();
    const table = await screen.findByRole("table");
    expect(within(table).getByText("Sales")).toBeTruthy();
    expect(within(table).getByText("2.4 MB")).toBeTruthy();
    expect(within(table).getByText("71")).toBeTruthy();
    const open = within(table).getByRole("link", { name: /Open the map of Sales/ });
    expect(open.getAttribute("href")).toBe(`/maps/${MAP}`);
    expect(open.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("asks before deleting, and Keep leaves the map alone", async () => {
    await toRecent();
    fireEvent.click(await screen.findByRole("button", { name: "Delete the map of Sales" }));
    expect(screen.getByText("Delete the map of Sales?")).toBeTruthy();
    expect(screen.getByText(/The database isn’t touched/)).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Keep" }));
    fireEvent.click(screen.getByRole("button", { name: "Keep" }));
    expect(screen.queryByText("Delete the map of Sales?")).toBeNull();
    expect(calls.some((call) => call.method === "DELETE")).toBe(false);
  });

  it("deletes after the confirmation and shows the empty state", async () => {
    await toRecent();
    fireEvent.click(await screen.findByRole("button", { name: "Delete the map of Sales" }));
    fireEvent.click(screen.getByRole("button", { name: "Delete map" }));
    await screen.findByText("Deleted the map of Sales.");
    await screen.findByText(/No maps yet/);
  });

  it("imports a snapshot file, naming its type, and says why a bad one failed", async () => {
    await toRecent();
    await screen.findByRole("table");
    const input = screen.getByLabelText("Snapshot file");
    fireEvent.change(input, {
      target: { files: [new File(['{"a":1}'], "wwi.json", { type: "application/json" })] },
    });
    await screen.findByText("Added a map from wwi.json.");
    expect(calls.find((call) => call.path === "/api/maps/import")?.method).toBe("POST");

    api.importStatus = 422;
    fireEvent.change(input, { target: { files: [new File(["nope"], "bad.json")] } });
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("The snapshot is not valid.");
    expect(alert.textContent).toContain(".json or .json.gz");
  });

  it("explains how to re-run with a password when no connection matches, then goes to Connect", async () => {
    await toRecent();
    fireEvent.click(await screen.findByRole("button", { name: "Re-run Sales" }));
    const dialog = await screen.findByRole("dialog", { name: "Re-run Sales" });
    expect(dialog.textContent).toContain(
      "Tick “Remember this connection” next time to re-run with just a password.",
    );
    expect(within(dialog).queryByLabelText("Password")).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Re-run extract" })).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "Set up the connection" }));
    await screen.findByRole("heading", { name: "Connect to SQL Server" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText<HTMLInputElement>("Server").value).toBe("db1");
    expect(calls.some((call) => call.path === "/api/jobs")).toBe(false);
  });

  it("re-runs through a dialog that traps focus, closes on Esc and asks for the password", async () => {
    await toPick();
    fireEvent.click(screen.getByRole("button", { name: "Recent maps" }));
    const opener = await screen.findByRole("button", { name: "Re-run Sales" });
    opener.focus();
    fireEvent.click(opener);

    const dialog = await screen.findByRole("dialog", { name: "Re-run Sales" });
    expect(dialog.textContent).toContain("db1, 1433 · SQL Server login · reader");
    expect(dialog.textContent).not.toContain("Remember this connection");
    const password = within(dialog).getByLabelText("Password");
    expect(document.activeElement).toBe(password);
    const cancel = within(dialog).getByRole("button", { name: "Cancel" });
    const submit = within(dialog).getByRole("button", { name: "Re-run extract" });
    submit.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(password);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(submit);
    expect(dialog.contains(cancel)).toBe(true);

    fireEvent.click(submit);
    expect(within(dialog).getByText("Enter the password.")).toBeTruthy();
    expect(calls.some((call) => call.path === "/api/jobs")).toBe(false);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(opener);

    fireEvent.click(opener);
    const again = await screen.findByRole("dialog", { name: "Re-run Sales" });
    fireEvent.change(within(again).getByLabelText("Password"), {
      target: { value: "Zq9-rerun-marker" },
    });
    fireEvent.click(within(again).getByRole("button", { name: "Re-run extract" }));
    await screen.findByRole("heading", { name: "Extracting Sales" });
    expect(calls.find((call) => call.path === "/api/jobs")?.body).toMatchObject({
      connection: { server: "db1", database: "Sales", password: "Zq9-rerun-marker" },
    });
    expect(document.body.innerHTML).not.toContain("Zq9-rerun-marker");
  });
});

describe("Quit", () => {
  it("stops the server and says the tab can be closed", async () => {
    stub();
    render(<App />);
    await screen.findByRole("heading", { name: "Connect to SQL Server" });
    fireEvent.change(screen.getByLabelText("Password"), { target: { value: "hunter2" } });
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    await screen.findByRole("heading", { name: "Schema Map has stopped" });
    expect(screen.getByText(/You can close this tab/)).toBeTruthy();
    expect(calls.find((call) => call.path === "/api/quit")?.method).toBe("POST");
    expect(screen.queryByRole("button", { name: "Quit" })).toBeNull();
    expect(document.body.innerHTML).not.toContain("hunter2");
  });

  it("reports a refusal instead of claiming to have stopped", async () => {
    stub();
    api.quitStatus = 500;
    render(<App />);
    await screen.findByRole("heading", { name: "Connect to SQL Server" });
    fireEvent.click(screen.getByRole("button", { name: "Quit" }));
    await screen.findByText(/could not stop/);
    expect(screen.queryByRole("heading", { name: "Schema Map has stopped" })).toBeNull();
  });
});

const BUSY = {
  error: {
    code: "job_running",
    message: "An extract is already running.",
    fix: "Wait for it to finish, or cancel it, then try again.",
    job_id: JOB,
  },
};

describe("a second tab starting an extract (#12)", () => {
  it("says another extract is running instead of reporting a failure", async () => {
    api.refuseStart = BUSY;
    await toPick();
    fireEvent.click(screen.getByRole("button", { name: "Extract map" }));
    await screen.findByRole("heading", { name: "Another extract is running", level: 2 });
    expect(screen.getByText(/probably in another tab/)).toBeTruthy();
    expect(screen.queryByText(/could not finish/)).toBeNull();
    expect(screen.queryByText(/Nothing was saved/)).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(document.querySelector(".lc-banner--fail")).toBeNull();
    const main = within(screen.getByRole("main"));
    expect(main.getByRole("button", { name: /Recent maps/ })).toBeTruthy();
  });

  it("links to the running extract's progress", async () => {
    api.refuseStart = BUSY;
    api.jobs = [running(["done", "running", "pending"])];
    await toPick();
    fireEvent.click(screen.getByRole("button", { name: "Extract map" }));
    fireEvent.click(await screen.findByRole("button", { name: "See its progress" }));
    await screen.findByRole("progressbar");
    expect(screen.getByRole("heading", { name: "Extract in progress", level: 1 })).toBeTruthy();
    expect(screen.getByText("1 of 3 sections done")).toBeTruthy();
    expect(calls.some((call) => call.path === `/api/jobs/${JOB}`)).toBe(true);
  });

  it("still waits when the server did not name the running extract", async () => {
    api.refuseStart = { error: { code: "job_running", message: "An extract is already running." } };
    await toPick();
    fireEvent.click(screen.getByRole("button", { name: "Extract map" }));
    await screen.findByRole("heading", { name: "Another extract is running", level: 2 });
    expect(screen.queryByRole("button", { name: "See its progress" })).toBeNull();
  });
});

describe("status states (#8, #9)", () => {
  it("shows a failed extract in the red banner with the cross, the fix inline, a red bar", async () => {
    api.jobs = [
      {
        job_id: JOB,
        state: "failed",
        sections: sections(["done", "failed", "pending"]),
        elapsed_ms: 62000,
        error: { code: "query_timeout", message: "Too slow.", fix: "Raise Query timeout." },
      },
    ];
    await startExtract();
    await screen.findByRole("heading", { name: "The extract stopped at Tables" });
    const banner = document.querySelector(".lc-banner--fail");
    expect(banner?.querySelector("svg")).not.toBeNull();
    const fix = banner?.querySelector(".lc-fix-line");
    expect(fix?.textContent).toBe("How to fix: Raise Query timeout.");
    expect(document.querySelector(".lc-progress--failed")).not.toBeNull();
  });

  it("marks Done with the success tile and icons on its actions", async () => {
    api.jobs = [
      {
        job_id: JOB,
        state: "done",
        map_id: MAP,
        sections: sections(["done", "done", "done"], [1, 71, 3]),
        elapsed_ms: 3000,
      },
    ];
    await startExtract();
    const heading = await screen.findByRole("heading", { name: "Your map of Sales is ready" });
    const card = heading.closest(".lc-card");
    expect(card?.querySelector(".lc-tile--ok")).not.toBeNull();
    expect(screen.getByRole("link", { name: /Open map/ }).querySelector("svg")).not.toBeNull();
    expect(
      screen.getByRole("button", { name: "Extract another database" }).querySelector("svg"),
    ).not.toBeNull();
  });

  it("tints the delete confirmation red with a warning icon", async () => {
    stub();
    render(<App />);
    await screen.findByRole("heading", { name: "Connect to SQL Server" });
    fireEvent.click(screen.getByRole("button", { name: "Recent maps" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete the map of Sales" }));
    const group = screen.getByRole("group", { name: "Delete the map of Sales?" });
    expect(group.className).toContain("lc-confirm");
    expect(group.querySelector(".lc-confirm__text svg")).not.toBeNull();
  });
});
