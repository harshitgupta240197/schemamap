// POST /api/join: add one person to the waitlist.
//
// Checks the email and role, drops honeypot hits without a trace, inserts into Supabase over its
// REST API with the anon key (the table allows INSERT only, see supabase/migrations), and answers the
// same way for a new and an already-known email so nobody can learn who has signed up.
// It never logs the email, nor anything Supabase sends back (an error body can quote it).

export const ROLES = ["DBA", "BI developer", "Data engineer", "Other"];

const EMAIL = /^[^\s@<>"',;:()[\]\\]+@[^\s@<>"',;:()[\]\\]+\.[^\s@<>"',;:()[\]\\]{2,}$/;
const MAX_EMAIL_LENGTH = 254;
const SUPABASE_TIMEOUT_MS = 8000;

export const MESSAGES = {
  ok: "Thank you. You are on the list. If you ticked the box, we will email you to arrange a short call.",
  email: "That email address does not look right. Please check it and try again.",
  role: "Please choose the role that fits you best.",
  method: "This address only accepts the sign-up form.",
  down: "Sorry, we could not save your sign-up just now. Nothing was lost on your side. Please try again in a few minutes.",
};

/** Read one text field from a parsed form or JSON body. */
function text(body, key) {
  const value = body?.[key];
  return typeof value === "string" ? value.trim() : "";
}

/** True for a checked checkbox in a form post ("on") or a JSON body (true). */
function checked(body, key) {
  const value = body?.[key];
  return value === true || value === "on" || value === "true";
}

/** The body as an object, whether the platform parsed it or handed us the raw string. */
function parseBody(req) {
  const body = req.body;
  if (body === undefined || body === null) {
    return {};
  }
  if (typeof body === "string") {
    const type = String(req.headers?.["content-type"] ?? "");
    try {
      return type.includes("json")
        ? JSON.parse(body)
        : Object.fromEntries(new URLSearchParams(body));
    } catch {
      return {};
    }
  }
  return typeof body === "object" ? body : {};
}

/** Insert one row. Returns "saved", "duplicate" or "failed". */
async function insert(row) {
  const base = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY;
  if (!base || !key) {
    console.error("join: SUPABASE_URL or SUPABASE_ANON_KEY is not set");
    return "failed";
  }
  try {
    const response = await fetch(`${base.replace(/\/+$/, "")}/rest/v1/waitlist`, {
      method: "POST",
      headers: {
        apikey: key,
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
        prefer: "return=minimal",
      },
      body: JSON.stringify(row),
      signal: AbortSignal.timeout(SUPABASE_TIMEOUT_MS),
    });
    if (response.ok) {
      return "saved";
    }
    if (response.status === 409) {
      return "duplicate";
    }
    console.error(`join: Supabase answered ${String(response.status)}`);
    return "failed";
  } catch (error) {
    console.error(
      `join: Supabase request failed (${error instanceof Error ? error.name : "error"})`,
    );
    return "failed";
  }
}

function page(title, message, ok) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<link rel="stylesheet" href="/style.css">
</head>
<body>
<main class="notice" id="main">
<h1>${title}</h1>
<p role="${ok ? "status" : "alert"}">${message}</p>
<p>To have your details deleted, write to <a href="mailto:YOUR-ADDRESS">YOUR-ADDRESS</a>.</p>
<p><a href="/${ok ? "" : "#join"}">${ok ? "Back to Schema Map" : "Back to the form"}</a></p>
</main>
</body>
</html>
`;
}

function wantsJson(req) {
  return String(req.headers?.accept ?? "").includes("application/json");
}

function reply(req, res, status, message) {
  const ok = status === 200;
  res.setHeader("cache-control", "no-store");
  if (wantsJson(req)) {
    res.status(status).json({ ok, message });
    return;
  }
  res.setHeader("content-type", "text/html; charset=utf-8");
  res.status(status).send(page(ok ? "You are on the list" : "That did not work", message, ok));
}

/** Vercel Node function. */
export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("allow", "POST");
    reply(req, res, 405, MESSAGES.method);
    return;
  }
  const body = parseBody(req);

  // Bots fill every field. Say thank you and store nothing.
  if (text(body, "website") !== "") {
    reply(req, res, 200, MESSAGES.ok);
    return;
  }
  const email = text(body, "email").toLowerCase();
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL.test(email)) {
    reply(req, res, 400, MESSAGES.email);
    return;
  }
  const role = text(body, "role");
  if (!ROLES.includes(role)) {
    reply(req, res, 400, MESSAGES.role);
    return;
  }

  const result = await insert({ email, role, wants_call: checked(body, "wants_call") });
  if (result === "failed") {
    reply(req, res, 503, MESSAGES.down);
    return;
  }
  reply(req, res, 200, MESSAGES.ok);
}
