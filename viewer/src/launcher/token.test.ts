import { describe, expect, it, vi } from "vitest";
import { fragmentCode, storedToken, storeToken, takeCode, TOKEN_KEY } from "./token";

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

const blocked = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

const at = (hash: string) => ({ hash, pathname: "/", search: "" });

describe("fragmentCode", () => {
  it("reads c from the fragment", () => {
    expect(fragmentCode("#c=abc-_123")).toBe("abc-_123");
    expect(fragmentCode("#x=1&c=abc")).toBe("abc");
  });

  it("is null without a code", () => {
    expect(fragmentCode("")).toBeNull();
    expect(fragmentCode("#")).toBeNull();
    expect(fragmentCode("#c=")).toBeNull();
    expect(fragmentCode("#code=abc")).toBeNull();
    expect(fragmentCode("#t=abc")).toBeNull();
  });
});

describe("takeCode", () => {
  it("returns the code and strips the fragment from the address bar", () => {
    const history = { replaceState: vi.fn() };
    expect(takeCode(at("#c=secret"), history)).toBe("secret");
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/");
  });

  it("keeps the query string when stripping", () => {
    const history = { replaceState: vi.fn() };
    takeCode({ hash: "#c=s", pathname: "/", search: "?a=1" }, history);
    expect(history.replaceState).toHaveBeenCalledWith(null, "", "/?a=1");
  });

  it("leaves a plain address alone", () => {
    const history = { replaceState: vi.fn() };
    expect(takeCode(at(""), history)).toBeNull();
    expect(history.replaceState).not.toHaveBeenCalled();
  });

  it("still strips a stray fragment that holds no code", () => {
    const history = { replaceState: vi.fn() };
    expect(takeCode(at("#other"), history)).toBeNull();
    expect(history.replaceState).toHaveBeenCalledOnce();
  });
});

describe("the stored token", () => {
  it("is kept under one key and read back", () => {
    const storage = memoryStorage();
    storeToken(storage, "t0k3n");
    expect(storage.values.get(TOKEN_KEY)).toBe("t0k3n");
    expect(storedToken(storage)).toBe("t0k3n");
  });

  it("is null when there is none", () => {
    expect(storedToken(memoryStorage())).toBeNull();
  });

  it("survives blocked storage without throwing", () => {
    expect(() => {
      storeToken(blocked, "t");
    }).not.toThrow();
    expect(storedToken(blocked)).toBeNull();
  });
});
