import { describe, expect, it, vi } from "vitest";
import { startSession } from "./session";
import { TOKEN_KEY } from "./token";

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

const at = (hash: string) => ({ hash, pathname: "/", search: "" });
const answer = (status: number, body: unknown) =>
  vi.fn<typeof fetch>(() => Promise.resolve(new Response(JSON.stringify(body), { status })));

describe("startSession with a launch code", () => {
  it("posts the code once, keeps the token in sessionStorage and clears the address bar", async () => {
    const storage = memoryStorage();
    const history = { replaceState: vi.fn() };
    const fetcher = answer(200, { token: "session-token" });

    const session = await startSession(at("#c=launch-code"), storage, history, fetcher);

    expect(session).toEqual({ kind: "ready", token: "session-token" });
    expect(storage.values.get(TOKEN_KEY)).toBe("session-token");
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/");
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0] ?? [];
    expect(url).toBe("/api/session");
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe(JSON.stringify({ code: "launch-code" }));
    expect(init?.credentials).toBe("omit");
    expect(init?.referrerPolicy).toBe("no-referrer");
  });

  it("never puts the code or the token in a URL", async () => {
    const fetcher = answer(200, { token: "session-token" });
    await startSession(at("#c=launch-code"), memoryStorage(), { replaceState: vi.fn() }, fetcher);
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual(["/api/session"]);
  });

  it("reports a refused code (used, expired or wrong) and keeps nothing", async () => {
    const storage = memoryStorage({});
    const session = await startSession(
      at("#c=used"),
      storage,
      { replaceState: vi.fn() },
      answer(401, { error: { code: "unauthorized" } }),
    );
    expect(session).toEqual({ kind: "code-refused" });
    expect(storage.values.size).toBe(0);
  });

  it("does not fall back to an older stored token when the code is refused", async () => {
    const storage = memoryStorage({ [TOKEN_KEY]: "older" });
    const session = await startSession(
      at("#c=used"),
      storage,
      { replaceState: vi.fn() },
      answer(401, {}),
    );
    expect(session).toEqual({ kind: "code-refused" });
  });

  it("reports other errors, an answer without a token, and a server that is gone", async () => {
    const history = { replaceState: vi.fn() };
    expect(await startSession(at("#c=x"), memoryStorage(), history, answer(500, {}))).toEqual({
      kind: "error",
      status: 500,
    });
    expect(await startSession(at("#c=x"), memoryStorage(), history, answer(200, {}))).toEqual({
      kind: "error",
      status: 200,
    });
    expect(
      await startSession(at("#c=x"), memoryStorage(), history, answer(200, { token: 5 })),
    ).toEqual({ kind: "error", status: 200 });
    const gone = vi.fn<typeof fetch>(() => Promise.reject(new TypeError("Failed to fetch")));
    expect(await startSession(at("#c=x"), memoryStorage(), history, gone)).toEqual({
      kind: "unreachable",
    });
  });

  it("still returns the token when storage is blocked", async () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    const session = await startSession(
      at("#c=x"),
      blocked,
      { replaceState: vi.fn() },
      answer(200, { token: "t" }),
    );
    expect(session).toEqual({ kind: "ready", token: "t" });
  });
});

describe("startSession without a launch code", () => {
  it("uses the token an earlier load kept, without calling the server", async () => {
    const fetcher = answer(200, {});
    const session = await startSession(
      at(""),
      memoryStorage({ [TOKEN_KEY]: "earlier" }),
      { replaceState: vi.fn() },
      fetcher,
    );
    expect(session).toEqual({ kind: "ready", token: "earlier" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("says there is no link when nothing was kept", async () => {
    const fetcher = answer(200, {});
    const session = await startSession(at(""), memoryStorage(), { replaceState: vi.fn() }, fetcher);
    expect(session).toEqual({ kind: "no-link" });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("does not take the old #t= token form as a code", async () => {
    const fetcher = answer(200, {});
    const session = await startSession(
      at("#t=old"),
      memoryStorage(),
      { replaceState: vi.fn() },
      fetcher,
    );
    expect(session).toEqual({ kind: "no-link" });
    expect(fetcher).not.toHaveBeenCalled();
  });
});
