// End-to-end against a real local Supabase (`supabase start`) through the real dev server.
// Run with `npm run test:integration`. The service-role key is used here only to count and clear
// rows; the site itself only ever gets the anon key.
import { spawn } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { supabaseEnv } from "../scripts/supabase-env.mjs";

const PORT = "4174";
const SITE = `http://127.0.0.1:${PORT}`;
const { url, anonKey, serviceRoleKey } = supabaseEnv();
const REST = `${url}/rest/v1/waitlist`;

let server;

function rest(key, { method = "GET", query = "", body } = {}) {
  return fetch(`${REST}${query}`, {
    method,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      prefer: "return=representation",
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function rows() {
  const response = await rest(serviceRoleKey);
  expect(response.status).toBe(200);
  return response.json();
}

async function clear() {
  await rest(serviceRoleKey, { method: "DELETE", query: "?id=not.is.null" });
}

/** A JSON post, as join.js sends it. */
function signup(fields) {
  return fetch(`${SITE}/api/join`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify(fields),
  });
}

beforeAll(async () => {
  server = spawn("node", ["dev-server.mjs"], {
    stdio: "ignore",
    env: { ...process.env, SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, PORT },
  });
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      await fetch(SITE);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  throw new Error("dev server did not start");
});

afterAll(async () => {
  server?.kill();
  await clear();
});

beforeEach(clear);

describe("waitlist against real Supabase", () => {
  it("a signup inserts exactly one row", async () => {
    const response = await signup({ email: "Ada@Example.com", role: "DBA", wants_call: true });
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ email: "ada@example.com", role: "DBA", wants_call: true });
  });

  it("the same email again shows success and keeps one row", async () => {
    const first = await signup({ email: "ada@example.com", role: "DBA" });
    const second = await signup({ email: "ADA@example.com", role: "Other" });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0].role).toBe("DBA");
  });

  it("a honeypot hit shows success and stores nothing", async () => {
    const response = await signup({ email: "bot@example.com", role: "DBA", website: "x.com" });
    expect(response.status).toBe(200);
    expect(await rows()).toHaveLength(0);
  });

  it("a form post with JavaScript off works end to end", async () => {
    const response = await fetch(`${SITE}/api/join`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "text/html" },
      body: new URLSearchParams({ email: "grace@example.com", role: "Data engineer", website: "" }),
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("You are on the list");
    const stored = await rows();
    expect(stored.map((row) => row.email)).toEqual(["grace@example.com"]);
  });

  describe("the anon key", () => {
    beforeEach(async () => {
      await signup({ email: "seed@example.com", role: "DBA" });
      expect(await rows()).toHaveLength(1);
    });

    it("cannot read any row", async () => {
      const response = await rest(anonKey);
      const body = await response.json();
      // Either an empty list or a permission error is fine; a row leaking is not.
      expect(Array.isArray(body) ? body : []).toEqual([]);
      expect(JSON.stringify(body)).not.toContain("seed@example.com");
    });

    it("cannot update a row", async () => {
      await rest(anonKey, {
        method: "PATCH",
        query: "?email=eq.seed@example.com",
        body: { role: "Other" },
      });
      expect((await rows())[0].role).toBe("DBA");
    });

    it("cannot delete a row", async () => {
      await rest(anonKey, { method: "DELETE", query: "?email=eq.seed@example.com" });
      expect(await rows()).toHaveLength(1);
    });
  });
});
