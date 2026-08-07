import { defineConfig } from "tsup";

export default defineConfig([
  // ── Main entry: the BrowserSession Node API ──────────────────────────────
  // ESM only — it uses `import.meta.url` and a lazy `import("playwright")`.
  {
    entry: ["src/index.ts"],
    format: ["esm"],
    // `audit` and `serialize` are PRIVATE workspace packages — npm cannot
    // resolve them, so both halves are required: `noExternal` inlines the JS,
    // `dts.resolve` inlines the declarations. Without the second the shipped
    // `.d.ts` keeps `from "@real-a11y-dev/audit"` (it re-exports `Finding`),
    // which is `TS2307` under `skipLibCheck: false` and a silent `any` under
    // the common default. `surface:check` fails on exactly that.
    dts: { resolve: ["@real-a11y-dev/audit", "@real-a11y-dev/serialize"] },
    sourcemap: true,
    clean: true,
    treeshake: true,
    // playwright is an optional peer, resolved by the host — never bundle it.
    external: ["playwright"],
    noExternal: ["@real-a11y-dev/audit", "@real-a11y-dev/serialize"],
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
    // No sourcemap: this bundle is injected as inline source into someone
    // else's page, so the appended `//# sourceMappingURL=…` resolves relative
    // to the page under test and 404s. Nobody debugs the injected bundle from
    // the target page, and the emitted .map has no other consumer.
    sourcemap: false,
    treeshake: true,
    dts: false,
    clean: false, // the main config above already cleaned dist/
    outDir: "dist",
  },
]);
