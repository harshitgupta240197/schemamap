// Reads the local Supabase stack's URL and keys from `supabase status` at runtime.
// The values are returned to the caller and never printed or written to disk.
import { execFileSync } from "node:child_process";

/** Parse `KEY="value"` lines from `supabase status -o env`. */
export function parseEnv(output) {
  const values = {};
  for (const line of output.split("\n")) {
    const match = /^([A-Z_]+)="?(.*?)"?$/.exec(line.trim());
    if (match) {
      values[match[1]] = match[2];
    }
  }
  return values;
}

/** The local stack's API URL, anon key and service-role key. Throws if it is not running. */
export function supabaseEnv() {
  const output = execFileSync("supabase", ["status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const values = parseEnv(output);
  const { API_URL: url, ANON_KEY: anonKey, SERVICE_ROLE_KEY: serviceRoleKey } = values;
  if (!url || !anonKey || !serviceRoleKey) {
    throw new Error("Local Supabase is not running. Start it with `npm run local:up`.");
  }
  return { url, anonKey, serviceRoleKey };
}
