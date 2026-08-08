import { defineConfig } from "tsup";

// ── IIFE page-bundle — built FIRST, on its own ──────────────────────────────
//
// Split out of `tsup.config.ts` because the main entry now inlines this file's
// output as a string (`__REAL_A11Y_PAGE_BUNDLE__`). `defineConfig([...])`
// evaluates every config up front, so a `define` in the same array would read
// this bundle before it exists on a clean build, or read the PREVIOUS build's
// copy on a rebuild — stale in a way nothing would report. Two invocations,
// ordered by `build`, make the dependency real instead of implied.
//
// Injected into the page by BrowserSession and the testing Playwright adapter.
// Sets window.__realA11y__ = { auditSnapshot, … }. Emitted as
// dist/page-bundle.iife.global.js (tsup appends `.global` when globalName is
// set) — the filename still matters: it is what the main config reads.
export default defineConfig({
  entry: { "page-bundle.iife": "src/page-bundle.ts" },
  format: ["iife"],
  globalName: "__realA11y__",
  // No sourcemap: this bundle is injected as inline source into someone else's
  // page, so an appended `//# sourceMappingURL=…` resolves relative to the page
  // under test and 404s. Nobody debugs the injected bundle from the target page.
  sourcemap: false,
  treeshake: true,
  dts: false,
  // This pass now runs first, so it owns the clean.
  clean: true,
  outDir: "dist",
});
