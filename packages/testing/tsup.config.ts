import { defineConfig } from "tsup";

export default defineConfig([
  // ── Main entries: ESM + CJS ─────────────────────────────────────────────
  {
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
  },

  // ── IIFE page-bundle ─────────────────────────────────────────────────────
  // Injected into the browser page by the Playwright adapter.
  // Sets window.__realA11y__ = { auditSnapshot, outlineSnapshot, … }
  {
    entry: { "page-bundle.iife": "src/page-bundle.ts" },
    format: ["iife"],
    globalName: "__realA11y__",
    sourcemap: true,
    treeshake: true,
    dts: false,
    clean: false, // main config already cleaned dist/
    outDir: "dist",
  },
]);
