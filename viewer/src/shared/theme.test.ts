import { afterEach, describe, expect, test, vi } from "vitest";
import { initTheme, readStoredTheme, resolveTheme, setTheme, THEME_STORAGE_KEY } from "./theme";

afterEach(() => {
  vi.restoreAllMocks();
  window.localStorage.clear();
  delete document.documentElement.dataset["theme"];
});

describe("resolveTheme", () => {
  test.each([
    ["light", true, "light"],
    ["dark", false, "dark"],
    ["system", true, "dark"],
    ["system", false, "light"],
  ] as const)("%s with system dark=%s is %s", (choice, systemDark, expected) => {
    expect(resolveTheme(choice, systemDark)).toBe(expected);
  });
});

describe("readStoredTheme", () => {
  test("is light when nothing is stored", () => {
    expect(readStoredTheme()).toBe("light");
  });

  test("is light for a value that is not a theme", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "sepia");
    expect(readStoredTheme()).toBe("light");
  });

  test("is light when storage throws", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(readStoredTheme()).toBe("light");
  });

  test("returns a stored choice", () => {
    window.localStorage.setItem(THEME_STORAGE_KEY, "system");
    expect(readStoredTheme()).toBe("system");
  });
});

describe("setTheme", () => {
  test("applies and stores the choice", () => {
    initTheme();
    setTheme("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
    expect(window.localStorage.getItem(THEME_STORAGE_KEY)).toBe("dark");
  });

  test("still applies when storage throws on write", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("full", "QuotaExceededError");
    });
    setTheme("dark");
    expect(document.documentElement.dataset["theme"]).toBe("dark");
  });
});
