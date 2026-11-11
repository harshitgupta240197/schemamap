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
      // One spec only: the map must open over file:// and finish its layout.
      name: "firefox",
      testMatch: "firefox.spec.ts",
      use: { browserName: "firefox" },
    },
  ],
});
