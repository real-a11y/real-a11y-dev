import { defineConfig } from "tsup";

export default defineConfig([
  // ── Main entry: the BrowserSession Node API ──────────────────────────────
  // ESM only — it uses `import.meta.url` and a lazy `import("playwright")`.
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    dts: true,
    sourcemap: true,
    clean: true,
    treeshake: true,
    // playwright is an optional peer, resolved by the host — never bundle it.
    external: ["playwright"],
  },

  // ── IIFE page-bundle ─────────────────────────────────────────────────────
  // Injected into the browser page by BrowserSession and the testing
  // Playwright adapter. Sets window.__realA11y__ = { auditSnapshot, … }.
  // Emitted as dist/page-bundle.iife.global.js (tsup appends `.global` when
  // globalName is set) — that exact filename is resolved by both consumers.
  {
    entry: { "page-bundle.iife": "src/page-bundle.ts" },
    format: ["iife"],
    globalName: "__realA11y__",
    sourcemap: true,
    treeshake: true,
    dts: false,
    clean: false, // the main config above already cleaned dist/
    outDir: "dist",
  },
]);
