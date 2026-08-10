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
const BUNDLE_FILE = path.resolve(__dirname, "dist/page-bundle.iife.global.js");

/**
 * Read the page-bundle to inline.
 *
 * Called from `esbuildOptions`, i.e. DURING a build — never at config-module
 * scope. That distinction is the whole point: this reads a gitignored BUILD
 * ARTIFACT, so reading it while the config module evaluates makes the config
 * itself unloadable whenever the artifact is absent. `bundle-require` evaluates
 * the config for every tsup invocation, so a bare `pnpm exec tsup`, a root
 * `pnpm -r --parallel dev`, or any tool that merely loads the config would die
 * with a raw ENOENT before tsup printed anything.
 *
 * `packages/inspector/tsup.config.ts` looks like precedent for a config-scope
 * read and is not: it reads `../ui/src/styles`, committed SOURCE that is always
 * present. Artifact vs source is the difference, and it is why this one is lazy.
 */
function readPageBundle(): string {
  try {
    return readFileSync(BUNDLE_FILE, "utf8");
  } catch {
    throw new Error(
      `The page-bundle has not been built yet, so there is nothing to inline.\n` +
        `  Expected: ${BUNDLE_FILE}\n\n` +
        `  Run \`pnpm build\` in this package once — it runs\n` +
        `  tsup.page-bundle.config.ts first, which emits that file.`,
    );
  }
}

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
  // Set here rather than in `define` so the artifact is read during the build,
  // not while this config module is being evaluated. See `readPageBundle`.
  esbuildOptions(options) {
    options.define = {
      ...options.define,
      __REAL_A11Y_PAGE_BUNDLE__: JSON.stringify(readPageBundle()),
    };
  },
});
