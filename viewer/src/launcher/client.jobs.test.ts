import { describe, expect, it, vi } from "vitest";
import { downloadMap, importMap, isGzip, startJob } from "./client";
import { parseJobStatus, parseMaps } from "./model";

const reply = (body: unknown, init: ResponseInit = {}) =>
  vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), init)));

describe("snapshot upload", () => {
  it("names gzip by its first two bytes, not by the file name", async () => {
    expect(await isGzip(new Blob([new Uint8Array([0x1f, 0x8b, 8])]))).toBe(true);
    expect(await isGzip(new Blob(['{"a":1}']))).toBe(false);
    expect(await isGzip(new Blob([]))).toBe(false);
  });

  it("sends the file as the body with the matching type and the token", async () => {
    const fetcher = reply({ map_id: "a".repeat(32) });
    const gz = new Blob([new Uint8Array([0x1f, 0x8b, 8, 0])]);
    const outcome = await importMap("tok", gz, fetcher);
    expect(outcome).toEqual({ ok: true, value: "a".repeat(32) });
    const init = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[0]).toBe("/api/maps/import");
    expect(init[1].body).toBe(gz);
    expect(init[1].headers).toMatchObject({ "Content-Type": "application/gzip" });
    await importMap("tok", new Blob(["{}"]), fetcher);
    const second = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(second[1].headers).toMatchObject({ "Content-Type": "application/json" });
  });

  it("turns a refusal into the server's words", async () => {
    const fetcher = reply({ error: { message: "Not a snapshot." } }, { status: 422 });
    expect(await importMap("tok", new Blob(["x"]), fetcher)).toEqual({
      ok: false,
      failure: { status: 422, message: "Not a snapshot.", fix: null },
    });
  });
});

describe("jobs and downloads", () => {
  it("posts the connection and the remember flag to start a job", async () => {
    const fetcher = reply({ job_id: "j".repeat(32) }, { status: 202 });
    const body = {
      server: "s",
      port: 1433,
      database: "d",
      auth: "sql",
      trust_server_certificate: false,
      connect_timeout: 15,
      query_timeout: 60,
    };
    expect(await startJob("tok", body, true, fetcher)).toEqual({ ok: true, value: "j".repeat(32) });
    const init = (fetcher.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({ connection: body, remember: true });
  });

  it("takes the file name from the server's Content-Disposition", async () => {
    const fetcher = vi.fn(() =>
      Promise.resolve(
        new Response("<html></html>", {
          headers: { "Content-Disposition": 'attachment; filename="Sales-map.html"' },
        }),
      ),
    );
    const outcome = await downloadMap("tok", "a".repeat(32), fetcher);
    expect(outcome.ok && outcome.value.name).toBe("Sales-map.html");
  });
});

describe("job and map answers", () => {
  it("reads a job status and drops sections it cannot read", () => {
    const job = parseJobStatus({
      job_id: "j",
      state: "failed",
      elapsed_ms: 1200,
      sections: [
        { name: "tables", state: "failed", count: null },
        { name: "views", state: "weird" },
        "nope",
      ],
      error: { code: "query_timeout", message: "Too slow.", fix: "Raise it." },
    });
    expect(job?.sections).toEqual([{ name: "tables", state: "failed", count: null }]);
    expect(job?.error).toEqual({ code: "query_timeout", message: "Too slow.", fix: "Raise it." });
    expect(parseJobStatus({ job_id: "j", state: "sideways" })).toBeNull();
  });

  it("reads the maps list and skips malformed entries", () => {
    const maps = parseMaps({
      maps: [
        { id: "a", database: "D", server: null, extracted_at: "x", tables: 1, bytes: 2 },
        { id: "b" },
      ],
    });
    expect(maps).toEqual([
      { id: "a", database: "D", server: null, extractedAt: "x", tables: 1, bytes: 2 },
    ]);
    expect(parseMaps({})).toBeNull();
  });
});
