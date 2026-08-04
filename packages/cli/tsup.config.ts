import { defineConfig } from "tsup";

export default defineConfig({
  // `index` is the bin (has a shebang). The CLI is a command, not a library:
  // the programmatic engine (fingerprints, artifact, diff, baselines) lives in
  // @real-a11y-dev/snapshot, so there is no importable `.` entry here.
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
  // The session registry is a PRIVATE workspace package: npm can never resolve
  // it, so it must be bundled into the dist (it is a devDependency for the
  // same reason — a published "dependencies" entry would break installs).
  noExternal: ["@real-a11y-dev/session-registry"],
  banner: { js: "" },
});
