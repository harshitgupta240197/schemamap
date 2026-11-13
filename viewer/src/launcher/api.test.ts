import { describe, expect, it, vi } from "vitest";
import { apiGet, healthMessage, TOKEN_HEADER } from "./api";

const answer = (status: number) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response("{}", { status })));

describe("apiGet", () => {
  it("sends the token as a header, never in the URL, with no cookies or referrer", async () => {
    const fetcher = answer(200);
    await apiGet("/api/health", "secret", fetcher);
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("/api/health");
    expect(init?.headers).toEqual({ [TOKEN_HEADER]: "secret" });
    expect(init?.credentials).toBe("omit");
    expect(init?.referrerPolicy).toBe("no-referrer");
  });
});

describe("healthMessage", () => {
  it("says connected on 200", async () => {
    expect(await healthMessage("t", answer(200))).toBe("Connected to Schema Map");
  });

  it("explains a missing token without calling the server", async () => {
    const fetcher = answer(200);
    expect(await healthMessage(null, fetcher)).toMatch(/needs the link printed/);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("explains a rejected token", async () => {
    expect(await healthMessage("t", answer(401))).toMatch(/expired/);
  });

  it("explains other errors and a server that is gone", async () => {
    expect(await healthMessage("t", answer(500))).toMatch(/error \(500\)/);
    const gone = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await healthMessage("t", gone)).toMatch(/not answering/);
  });
});
