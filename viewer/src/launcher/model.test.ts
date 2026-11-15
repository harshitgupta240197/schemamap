import { describe, expect, it } from "vitest";
import {
  parseCapabilities,
  parseDatabases,
  parseFailure,
  parseRemembered,
  parseTestResult,
} from "./model";
import { capabilitiesBody } from "./testing";

describe("parseCapabilities", () => {
  it("reads the OS and the modes", () => {
    const caps = parseCapabilities(capabilitiesBody("macos"));
    expect(caps?.os).toBe("macos");
    expect(caps?.authModes.map((mode) => mode.id)).toContain("entra-interactive");
  });

  it.each([null, "x", {}, { os: "beos", auth_modes: [] }, { os: "linux", auth_modes: [] }])(
    "refuses %j",
    (body) => {
      expect(parseCapabilities(body)).toBeNull();
    },
  );

  it("drops a mode with an unknown group", () => {
    const caps = parseCapabilities({
      os: "linux",
      auth_modes: [
        { id: "sql", group: "sql", label: "SQL", needs_user: true, needs_password: true },
        { id: "x", group: "other", label: "X", needs_user: false, needs_password: false },
      ],
    });
    expect(caps?.authModes.map((mode) => mode.id)).toEqual(["sql"]);
  });
});

describe("parseTestResult", () => {
  const check = (name: string, status: string) => ({
    name,
    status,
    message: `${name} message`,
    fix: null,
    fix_sql: null,
  });

  it("orders fail, warn, pass and keeps the server's order inside each", () => {
    const result = parseTestResult({
      checks: [
        check("a", "ok"),
        check("b", "warn"),
        check("c", "fail"),
        check("d", "ok"),
        check("e", "fail"),
        check("f", "warn"),
      ],
      connected: true,
    });
    expect(result?.checks.map((c) => c.name)).toEqual(["c", "e", "b", "f", "a", "d"]);
    expect(result?.connected).toBe(true);
  });

  it("falls back to the name when a message is missing, and refuses an empty list", () => {
    const result = parseTestResult({
      checks: [{ name: "Connection", status: "ok" }],
      connected: false,
    });
    expect(result?.checks[0]?.message).toBe("Connection");
    expect(parseTestResult({ checks: [], connected: true })).toBeNull();
  });
});

describe("other answers", () => {
  it("keeps remembered entries that are well formed", () => {
    const entries = parseRemembered({
      connections: [
        { id: "x", server: "s", port: 1433, auth: "sql", user: "u", password: "leak" },
        { id: "y", server: "s", port: "1433", auth: "sql", user: null },
      ],
    });
    expect(entries).toEqual([{ id: "x", server: "s", port: 1433, auth: "sql", user: "u" }]);
    expect(Object.keys(entries[0] ?? {})).not.toContain("password");
  });

  it("reads database names and refuses a body without a list", () => {
    expect(parseDatabases({ databases: [{ name: "A" }, { nope: 1 }, { name: "B" }] })).toEqual([
      "A",
      "B",
    ]);
    expect(parseDatabases({})).toBeNull();
  });

  it("reads an error answer, and says something fixed for any other body", () => {
    expect(parseFailure(502, { error: { message: "No.", fix: "Try this." } })).toEqual({
      status: 502,
      message: "No.",
      fix: "Try this.",
    });
    expect(parseFailure(500, "<html>").message).toContain("500");
  });
});
