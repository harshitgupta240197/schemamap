// `npm run local:up`: start local Supabase, then serve the site with the real /api/join against it.
// The keys come from `supabase status` and go straight into the server's environment. They are
// never printed or written to a file, and `supabase start`'s own output (which lists them) is hidden.
import { spawn, spawnSync } from "node:child_process";
import { supabaseEnv } from "./supabase-env.mjs";

const start = spawnSync("supabase", ["start"], { encoding: "utf8" });
if (start.status !== 0) {
  console.error("supabase start failed. Is Docker running?");
  process.exit(start.status ?? 1);
}

const { url, anonKey } = supabaseEnv();
const port = process.env.PORT ?? "4173";
console.log(`Local Supabase is up. Site with the real waitlist: http://127.0.0.1:${port}`);

const server = spawn("node", ["dev-server.mjs"], {
  stdio: "inherit",
  env: { ...process.env, SUPABASE_URL: url, SUPABASE_ANON_KEY: anonKey, PORT: port },
});
server.on("exit", (code) => process.exit(code ?? 0));
