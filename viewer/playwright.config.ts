import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  globalSetup: "./e2e/global-setup.ts",
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  projects: [
    {
      name: "chromium",
      testIgnore: "firefox.spec.ts",
      use: { browserName: "chromium" },
    },
    {
      // The map must open over file:// and finish its layout, and its Content-Security-Policy
      // must hold (csp.spec.ts runs in both browsers).
      name: "firefox",
      testMatch: ["firefox.spec.ts", "csp.spec.ts", "flow.spec.ts"],
      use: { browserName: "firefox" },
    },
  ],
});
