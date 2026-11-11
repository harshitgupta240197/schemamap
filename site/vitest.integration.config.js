import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["integration/*.test.js"], environment: "node", testTimeout: 20000 },
});
