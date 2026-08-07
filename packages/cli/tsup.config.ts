import { defineConfig } from "tsup";

export default defineConfig({
  // `index` is the bin (has a shebang). The CLI is a command, not a library,
  // and there is no importable `.` entry here. The engine it drives
  // (fingerprints, artifact, diff, baselines) lives in @real-a11y-dev/snapshot,
  // which is now PRIVATE — so the CLI is not one way to reach that engine, it
  // is the way. `--format json` and `--session` are the programmatic surface.
  entry: ["src/index.ts", "src/daemon/entry.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // playwright is an (optional) peer dep, resolved by the host — never bundle.
  // @puppeteer/browsers is a regular dep but a large one (proxy-agent,
  // extract-zip, ...) — resolved from node_modules at runtime, never bundled.
  external: ["playwright", "@puppeteer/browsers"],
  // PRIVATE workspace packages: npm can never resolve them, so they are bundled
  // into the dist and held as devDependencies (a published "dependencies" entry
  // would break every install). No `dts.resolve` needed — the CLI emits no
  // public types that name them; the guard in `surface:check` says so if that
  // ever changes.
  noExternal: [
    "@real-a11y-dev/session-registry",
    "@real-a11y-dev/audit",
    "@real-a11y-dev/serialize",
    "@real-a11y-dev/snapshot",
  ],
  banner: { js: "" },
});
