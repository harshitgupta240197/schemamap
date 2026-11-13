import { describe, expect, it, vi } from "vitest";
import { fragmentToken, takeToken, TOKEN_KEY } from "./token";

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

describe("fragmentToken", () => {
  it("reads t from the fragment", () => {
    expect(fragmentToken("#t=abc-_123")).toBe("abc-_123");
    expect(fragmentToken("#x=1&t=abc")).toBe("abc");
  });

  it("is null without a token", () => {
    expect(fragmentToken("")).toBeNull();
    expect(fragmentToken("#")).toBeNull();
    expect(fragmentToken("#t=")).toBeNull();
    expect(fragmentToken("#token=abc")).toBeNull();
  });
});

describe("takeToken", () => {
  it("stores the token and strips the fragment from the address bar", () => {
    const storage = memoryStorage();
    const history = { replaceState: vi.fn() };
    expect(takeToken(at("#t=secret"), storage, history)).toBe("secret");
    expect(storage.values.get(TOKEN_KEY)).toBe("secret");
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("keeps the query string when stripping", () => {
    const history = { replaceState: vi.fn() };
    takeToken({ hash: "#t=s", pathname: "/", search: "?a=1" }, memoryStorage(), history);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/?a=1");
  });

  it("uses the stored token after a reload", () => {
    const history = { replaceState: vi.fn() };
    const storage = memoryStorage({ [TOKEN_KEY]: "earlier" });
    expect(takeToken(at(""), storage, history)).toBe("earlier");
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("prefers a new token in the fragment over a stored one", () => {
    const storage = memoryStorage({ [TOKEN_KEY]: "old" });
    expect(takeToken(at("#t=new"), storage, { replaceState: vi.fn() })).toBe("new");
    expect(storage.values.get(TOKEN_KEY)).toBe("new");
  });

  it("is null with no token anywhere, and still strips a stray fragment", () => {
    const history = { replaceState: vi.fn() };
    expect(takeToken(at("#other"), memoryStorage(), history)).toBeNull();
    expect(history.replaceState).toHaveBeenCalledOnce();
  });

  it("still returns the fragment token when storage throws", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    };
    expect(takeToken(at("#t=s"), broken, { replaceState: vi.fn() })).toBe("s");
    expect(takeToken(at(""), broken, { replaceState: vi.fn() })).toBeNull();
  });
});
