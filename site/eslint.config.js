import js from "@eslint/js";
import globals from "globals";

export default [
  { ignores: ["node_modules", "playwright-report", "test-results"] },
  js.configs.recommended,
  { files: ["join.js", "e2e/*.js"], languageOptions: { globals: globals.browser } },
  {
    files: [
      "api/*.js",
      "tests/*.js",
      "integration/*.js",
      "scripts/*.mjs",
      "e2e/*.js",
      "*.mjs",
      "*.config.js",
    ],
    languageOptions: { globals: globals.node },
  },
];
