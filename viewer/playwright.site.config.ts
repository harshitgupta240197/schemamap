import { defineConfig } from "@playwright/test";

// Makes the landing-page screenshots. Not part of `npx playwright test`: run it on purpose with
// `npm run site:shots`, then `uv run tools/site_shots.py` to optimise the PNGs into site/assets/.
export default defineConfig({
  testDir: "site-shots",
  reporter: "list",
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
});
