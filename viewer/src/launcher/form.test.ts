import { describe, expect, it } from "vitest";
import {
  applyRemembered,
  entraModes,
  initialForm,
  offeredGroups,
  toConnection,
  usable,
  validate,
  type FormState,
} from "./form";
import type { RememberedConnection } from "./model";
import { capabilities } from "./testing";

const linux = capabilities("linux");
const windows = capabilities("windows");

function filled(changes: Partial<FormState> = {}): FormState {
  return {
    ...initialForm(linux),
    server: "127.0.0.1",
    user: "schemamap_reader",
    password: "p@ss",
    ...changes,
  };
}

describe("the initial form", () => {
  it("starts with certificate trust off and nothing remembered", () => {
    const form = initialForm(linux);
    expect(form.trust).toBe(false);
    expect(form.remember).toBe(false);
    expect(form.password).toBe("");
  });

  it("uses the documented port and timeouts, and a SQL login first", () => {
    const form = initialForm(linux);
    expect([form.port, form.connectTimeout, form.queryTimeout, form.group]).toEqual([
      "1433",
      "15",
      "60",
      "sql",
    ]);
  });

  it("never sends the trust flag unless it was ticked", () => {
    expect(toConnection(filled(), linux)?.trust_server_certificate).toBe(false);
    expect(toConnection(filled({ trust: true }), linux)?.trust_server_certificate).toBe(true);
  });
});

describe("sign-in choices come from the server", () => {
  it("hides Windows when the OS is not Windows, even if the server listed the mode", () => {
    const odd = { ...windows, os: "linux" as const };
    expect(offeredGroups(linux)).toEqual(["sql", "entra"]);
    expect(offeredGroups(odd)).toEqual(["sql", "entra"]);
  });

  it("offers Windows on Windows", () => {
    expect(offeredGroups(windows)).toEqual(["sql", "windows", "entra"]);
  });

  it("lists exactly the Entra methods the API sent, in its order", () => {
    expect(entraModes(linux).map((mode) => mode.id)).toEqual([
      "entra-password",
      "entra-interactive",
      "entra-integrated",
    ]);
  });
});

describe("validation", () => {
  it("accepts a complete SQL login form", () => {
    expect(validate(filled(), linux)).toEqual({});
  });

  it("asks for what is missing, in plain words", () => {
    const errors = validate(
      filled({ server: " ", port: "70000", user: "", password: "", connectTimeout: "0" }),
      linux,
    );
    expect(Object.keys(errors).sort()).toEqual(
      ["connectTimeout", "password", "port", "server", "user"].sort(),
    );
    expect(errors.server).toBe("Enter the server name or address.");
  });

  it("refuses ports and timeouts that are not whole numbers in range", () => {
    for (const bad of ["", "abc", "1.5", "-1", "0", "65536", "1e3"]) {
      expect(validate(filled({ port: bad }), linux).port).toBeDefined();
    }
    expect(validate(filled({ port: "65535" }), linux).port).toBeUndefined();
    expect(validate(filled({ queryTimeout: "301" }), linux).queryTimeout).toBeDefined();
  });

  it("needs no user or password for Windows and integrated sign-in", () => {
    expect(validate(filled({ group: "windows", user: "", password: "" }), windows)).toEqual({});
    const integrated = filled({
      group: "entra",
      entraMode: "entra-integrated",
      user: "",
      password: "",
    });
    expect(validate(integrated, linux)).toEqual({});
  });

  it("needs both for Entra password, and only the password is withheld otherwise", () => {
    const form = filled({ group: "entra", entraMode: "entra-password", user: "", password: "" });
    expect(Object.keys(validate(form, linux)).sort()).toEqual(["password", "user"]);
  });
});

describe("the request", () => {
  it("carries the chosen mode id, trimmed text and numbers", () => {
    expect(toConnection(filled({ server: "  db1 ", port: " 14333 " }), linux)).toEqual({
      server: "db1",
      port: 14333,
      auth: "sql",
      user: "schemamap_reader",
      password: "p@ss",
      trust_server_certificate: false,
      connect_timeout: 15,
      query_timeout: 60,
    });
  });

  it("leaves the password out for modes that take none", () => {
    const body = toConnection(filled({ group: "entra", entraMode: "entra-interactive" }), linux);
    expect(body?.auth).toBe("entra-interactive");
    expect(body).not.toHaveProperty("password");
  });

  it("passes Windows sign-in through as the `windows` mode, with no password", () => {
    const body = toConnection(
      filled({ group: "windows", user: "", password: "typed-then-hidden" }),
      windows,
    );
    expect(body?.auth).toBe("windows");
    expect(body).not.toHaveProperty("password");
    expect(body).not.toHaveProperty("user");
    expect(JSON.stringify(body)).not.toContain("typed-then-hidden");
  });

  it("is null for a form that fails validation", () => {
    expect(toConnection(filled({ port: "x" }), linux)).toBeNull();
  });
});

describe("recent connections", () => {
  const sql: RememberedConnection = {
    id: "a".repeat(32),
    server: "db1",
    port: 1433,
    auth: "sql",
    user: "reader",
  };
  const win: RememberedConnection = { ...sql, id: "b".repeat(32), auth: "windows", user: null };
  const entra: RememberedConnection = {
    ...sql,
    id: "c".repeat(32),
    auth: "entra-integrated",
    user: null,
  };

  it("Use fills the five settings and clears the password", () => {
    const used = applyRemembered(filled({ password: "secret" }), entra, linux);
    expect(used).toMatchObject({
      server: "db1",
      port: "1433",
      group: "entra",
      entraMode: "entra-integrated",
      user: "",
      password: "",
    });
    expect(applyRemembered(filled({ password: "secret" }), sql, linux).password).toBe("");
  });

  it("an entry has no password to show", () => {
    expect(Object.keys(sql)).not.toContain("password");
  });

  it("hides a Windows entry off Windows and an entry for a mode the server does not know", () => {
    const unknown: RememberedConnection = { ...sql, id: "d".repeat(32), auth: "kerberos" };
    expect(usable([sql, win, entra, unknown], linux)).toEqual([sql, entra]);
    expect(usable([sql, win], windows)).toEqual([sql, win]);
  });
});
