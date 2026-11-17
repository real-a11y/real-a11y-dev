import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

// `@real-a11y-dev/testing/reporter` and `…/reporter/jest`, built after the library entries
// (`tsup.config.ts`, which cleans `dist` first) and apart from them. It runs
// in Node only, and finds its viewer from `import.meta.url`, which the CJS
// build needs shimmed. Built with the library, the shim's `path` and `url`
// imports landed in a chunk every entry shares, so the main entry would have
// stopped bundling for the browser.
//
// The viewer is the PRIVATE `snapshot-viewer` package's build (a
// devDependency, so pnpm builds it first). It ships as two files in
// `dist/viewer`, which the reporter reads and inlines into the page it writes.
const viewerDist = fileURLToPath(
  new URL("../snapshot-viewer/dist/", import.meta.url),
);
const viewerOut = fileURLToPath(new URL("./dist/viewer/", import.meta.url));

function copyViewer(): void {
  mkdirSync(viewerOut, { recursive: true });
  for (const file of ["viewer.js", "viewer.css"]) {
    if (!existsSync(viewerDist + file)) {
      throw new Error(
        `${viewerDist}${file} is missing: build @real-a11y-dev/snapshot-viewer first`,
      );
    }
    copyFileSync(viewerDist + file, viewerOut + file);
  }
}

export default defineConfig({
  entry: ["src/reporter.ts", "src/reporter-jest.ts"],
  format: ["esm", "cjs"],
  shims: true,
  // A reporter is its module's only export, its default, which Jest
  // `require`s. A CJS file that sets `exports.default` under a `.d.cts` that
  // says `export default` is what attw (packaging:check) rejects as a false
  // default export. So the CJS file ends `module.exports = Reporter`, by this
  // footer, and `cjsInterop` types it `export =`, as `require` sees it.
  //
  // The footer is ours rather than `cjsInterop`'s own: that one is added or
  // not depending on `treeshake` and `splitting`, and with `treeshake` it
  // landed after Rollup's `module.exports = Reporter` and replaced it with
  // `undefined`, which attw does not notice. Check by hand after a change:
  // `require("./dist/reporter-jest.cjs")` must be the class.
  cjsInterop: true,
  esbuildOptions(options, { format }) {
    if (format === "cjs") {
      options.footer = { js: "module.exports = module.exports.default;" };
    }
  },
  // The library build owns `dist`, and has already cleaned it.
  clean: false,
  // The records' types name core's: inline them, as the library build does.
  dts: { resolve: ["@real-a11y-dev/core"] },
  sourcemap: true,
  onSuccess: async () => copyViewer(),
});
