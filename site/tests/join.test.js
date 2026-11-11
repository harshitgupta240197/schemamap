import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import handler, { MESSAGES } from "../api/join.js";

const EMAIL = "Ada.Lovelace@example.com";

/** A response double with the parts of Vercel's `res` that the handler uses. */
function fakeRes() {
  const res = {
    headers: {},
    statusCode: 0,
    payload: undefined,
    setHeader(key, value) {
      res.headers[key.toLowerCase()] = value;
    },
    status(code) {
      res.statusCode = code;
      return res;
    },
    json(value) {
      res.payload = value;
    },
    send(value) {
      res.payload = value;
    },
  };
  return res;
}

function post(body, { json = true, method = "POST", type } = {}) {
  return {
    method,
    body,
    headers: { accept: json ? "application/json" : "text/html", "content-type": type ?? "" },
  };
}

const valid = { email: EMAIL, role: "DBA", wants_call: "on", website: "" };

let logged;
let fetchMock;

beforeEach(() => {
  process.env.SUPABASE_URL = "https://example.supabase.co/";
  process.env.SUPABASE_ANON_KEY = "anon-key-for-tests";
  fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 201 })));
  vi.stubGlobal("fetch", fetchMock);
  logged = [];
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    vi.spyOn(console, level).mockImplementation((...args) => logged.push(args.join(" ")));
  }
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("api/join", () => {
  it("saves a valid signup through the Supabase REST API", async () => {
    const res = fakeRes();
    await handler(post(valid), res);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, message: MESSAGES.ok });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://example.supabase.co/rest/v1/waitlist");
    expect(init.method).toBe("POST");
    expect(init.headers.apikey).toBe("anon-key-for-tests");
    expect(init.headers.authorization).toBe("Bearer anon-key-for-tests");
    expect(init.headers.prefer).toBe("return=minimal");
    expect(JSON.parse(init.body)).toEqual({
      email: "ada.lovelace@example.com",
      role: "DBA",
      wants_call: true,
    });
  });

  it("records wants_call false when the box is not ticked", async () => {
    await handler(post({ email: EMAIL, role: "Other" }), fakeRes());
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).wants_call).toBe(false);
  });

  it("reads a raw form-encoded body", async () => {
    const res = fakeRes();
    await handler(
      post("email=a%40b.co&role=BI+developer", { type: "application/x-www-form-urlencoded" }),
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({
      email: "a@b.co",
      role: "BI developer",
    });
  });

  it.each(["", "nobody", "a@b", "a b@example.com", "<x>@example.com", `${"a".repeat(250)}@b.co`])(
    "rejects the invalid email %j",
    async (email) => {
      const res = fakeRes();
      await handler(post({ ...valid, email }), res);
      expect(res.statusCode).toBe(400);
      expect(res.payload).toEqual({ ok: false, message: MESSAGES.email });
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["", "CEO", "dba", undefined])("rejects the bad role %j", async (role) => {
    const res = fakeRes();
    await handler(post({ ...valid, role }), res);
    expect(res.statusCode).toBe(400);
    expect(res.payload).toEqual({ ok: false, message: MESSAGES.role });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops a honeypot hit silently: same answer, nothing stored", async () => {
    const res = fakeRes();
    await handler(post({ ...valid, website: "http://spam.example" }), res);
    expect(res.statusCode).toBe(200);
    expect(res.payload).toEqual({ ok: true, message: MESSAGES.ok });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("answers a duplicate email exactly like a new one", async () => {
    const fresh = fakeRes();
    await handler(post(valid), fresh);
    fetchMock.mockResolvedValueOnce(
      new Response(`{"code":"23505","details":"Key (email)=(${EMAIL}) already exists."}`, {
        status: 409,
      }),
    );
    const duplicate = fakeRes();
    await handler(post(valid), duplicate);
    expect(duplicate.statusCode).toBe(fresh.statusCode);
    expect(duplicate.payload).toEqual(fresh.payload);
  });

  it("gives a friendly error when Supabase answers with a failure", async () => {
    fetchMock.mockResolvedValueOnce(new Response(`quota for ${EMAIL}`, { status: 500 }));
    const res = fakeRes();
    await handler(post(valid), res);
    expect(res.statusCode).toBe(503);
    expect(res.payload).toEqual({ ok: false, message: MESSAGES.down });
  });

  it("gives a friendly error when Supabase cannot be reached", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError(`fetch failed for ${EMAIL}`));
    const res = fakeRes();
    await handler(post(valid), res);
    expect(res.statusCode).toBe(503);
    expect(res.payload.message).toBe(MESSAGES.down);
  });

  it("gives the same friendly error when the environment is not set up", async () => {
    delete process.env.SUPABASE_URL;
    const res = fakeRes();
    await handler(post(valid), res);
    expect(res.statusCode).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never logs the email, whatever happens", async () => {
    await handler(post(valid), fakeRes());
    await handler(post({ ...valid, email: `bad ${EMAIL}` }), fakeRes());
    await handler(post({ ...valid, website: EMAIL }), fakeRes());
    fetchMock.mockResolvedValueOnce(new Response(EMAIL, { status: 409 }));
    await handler(post(valid), fakeRes());
    fetchMock.mockResolvedValueOnce(new Response(EMAIL, { status: 500 }));
    await handler(post(valid), fakeRes());
    fetchMock.mockRejectedValueOnce(new Error(EMAIL));
    await handler(post(valid), fakeRes());
    const everything = logged.join("\n").toLowerCase();
    expect(everything).not.toContain("lovelace");
    expect(everything).not.toContain("example.com");
  });

  it("answers a form post with a small HTML page that echoes nothing from the request", async () => {
    const res = fakeRes();
    await handler(
      post({ ...valid, email: "<script>x</script>@example.com" }, { json: false }),
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.payload).toContain(MESSAGES.email);
    expect(res.payload).not.toContain("<script>x");

    const ok = fakeRes();
    await handler(post(valid, { json: false }), ok);
    expect(ok.statusCode).toBe(200);
    expect(ok.payload).toContain(MESSAGES.ok);
    expect(ok.payload).not.toContain("lovelace");
  });

  it("refuses anything but POST", async () => {
    const res = fakeRes();
    await handler(post(undefined, { method: "GET" }), res);
    expect(res.statusCode).toBe(405);
    expect(res.headers.allow).toBe("POST");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
