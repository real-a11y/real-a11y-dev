import { readFileSync } from "fs";
import path from "path";

import { defineConfig } from "tsup";

// The injected page-bundle, inlined as a STRING rather than read from disk at
// runtime. It is built by `tsup.page-bundle.config.ts`, which `build` runs
// first — see the ordering note there.
//
// Why inline: the old code resolved `new URL("./page-bundle.iife.global.js",
// import.meta.url)`. That is correct only while this package is its own
// published artifact. Once it is PRIVATE and bundled into `cli` / `mcp` /
// `testing`, `import.meta.url` becomes the CONSUMER's dist, the file is not
// beside it, and every `attach()` / page open fails at runtime — silently,
// because nothing type-checks a path. Inlining removes the path entirely.
const PAGE_BUNDLE = readFileSync(
  path.resolve(__dirname, "dist/page-bundle.iife.global.js"),
  "utf8",
);

export default defineConfig({
  // ── Main entry: the BrowserSession Node API ────────────────────────────────
  // ESM only — it uses `import.meta.url` and a lazy `import("playwright")`.
  entry: ["src/index.ts"],
  format: ["esm"],
  // `audit` and `serialize` are PRIVATE workspace packages — npm cannot
  // resolve them, so both halves are required: `noExternal` inlines the JS,
  // `dts.resolve` inlines the declarations. Without the second the shipped
  // `.d.ts` keeps `from "@real-a11y-dev/audit"` — which is `TS2307` under
  // `skipLibCheck: false` and a silent `any` under the common default.
  //
  // Note WHY it keeps it: nothing here re-exports `Finding`. `export interface
  // PageSnapshot { findings: Finding[] }` merely NAMES the type, and a
  // structural reference is enough. So the rule is "does any emitted
  // declaration name a private package", not "do we re-export one" — checking
  // `index.ts` for `export … from` and finding none proves nothing.
  // `surface:check` fails on exactly this.
  dts: { resolve: ["@real-a11y-dev/audit", "@real-a11y-dev/serialize"] },
  sourcemap: true,
  // The page-bundle pass already cleaned dist/ — and its output is what the
  // `define` below inlines, so cleaning here would delete it.
  clean: false,
  treeshake: true,
  // playwright is an optional peer, resolved by the host — never bundle it.
  external: ["playwright"],
  noExternal: ["@real-a11y-dev/audit", "@real-a11y-dev/serialize"],
  define: {
    __REAL_A11Y_PAGE_BUNDLE__: JSON.stringify(PAGE_BUNDLE),
  },
});
