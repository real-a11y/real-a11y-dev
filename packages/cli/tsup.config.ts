import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { defineConfig } from "tsup";

// `show-report` serves the PRIVATE `snapshot-viewer` package's build (a
// devDependency, so pnpm builds it first). No code imports it: it ships as two
// files in `dist/viewer`, which the command reads and serves.
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
  // `index` is the bin (has a shebang). The CLI is a command, not a library,
  // and there is no importable `.` entry here. The engine it drives
  // (fingerprints, artifact, diff, baselines) lives in @real-a11y-dev/snapshot,
  // which is now PRIVATE — so the CLI is not one way to reach that engine, it
  // is the way. `--format json` and `--session` are the programmatic surface.
  entry: ["src/index.ts", "src/daemon/entry.ts"],
  format: ["esm"],
  // `dts.resolve` for the private packages even though the emit is currently
  // just a shebang: `src/args.ts` imports `ChromeChannel` / `OpenOptions` as
  // types from browser, and nothing watches this package — `surface:check` reads
  // only the `.d.ts` an `exports` `types` condition points at (cli has no
  // `exports` map) and `check-packaging.mjs` skips cli via ATTW_SKIP_PACKAGES.
  dts: {
    resolve: [
      "@real-a11y-dev/session-registry",
      "@real-a11y-dev/audit",
      "@real-a11y-dev/serialize",
      "@real-a11y-dev/snapshot",
      "@real-a11y-dev/browser",
      "@real-a11y-dev/core",
    ],
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
  // playwright is an (optional) peer dep, resolved by the host — never bundle.
  // @puppeteer/browsers is a regular dep but a large one (proxy-agent,
  // extract-zip, ...) — resolved from node_modules at runtime, never bundled.
  external: ["playwright", "@puppeteer/browsers"],
  // PRIVATE workspace packages: npm can never resolve them, so they are bundled
  // into the dist and held as devDependencies (a published "dependencies" entry
  // would break every install). The matching `dts.resolve` is set above — see
  // the note there for why it is there before it is needed.
  noExternal: [
    "@real-a11y-dev/session-registry",
    "@real-a11y-dev/audit",
    "@real-a11y-dev/serialize",
    "@real-a11y-dev/snapshot",
    "@real-a11y-dev/browser",
    "@real-a11y-dev/core",
  ],
  banner: { js: "" },
  onSuccess: async () => copyViewer(),
});
