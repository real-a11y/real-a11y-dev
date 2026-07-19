import { defineConfig } from "tsup";

export default defineConfig({
  // ESM + CJS entries. The injected IIFE page-bundle now lives in
  // @real-a11y-dev/browser; the Playwright adapter resolves it from there.
  entry: [
    "src/index.ts",
    "src/playwright.ts",
    "src/matchers.ts",
    "src/matchers-vitest.ts",
  ],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
