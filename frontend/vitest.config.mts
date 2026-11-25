import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

// Unit tests for plain TypeScript (schemas, helpers). Browser flows live in
// e2e/ and run with Playwright.
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
