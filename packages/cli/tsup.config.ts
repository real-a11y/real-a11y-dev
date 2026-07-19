import { defineConfig } from "tsup";

export default defineConfig({
  // `index` is the bin (has a shebang). The CLI is a command, not a library:
  // the programmatic engine (fingerprints, artifact, diff, baselines) lives in
  // @real-a11y-dev/snapshot, so there is no importable `.` entry here.
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // playwright is an (optional) peer dep, resolved by the host — never bundle.
  external: ["playwright"],
  banner: { js: "" },
});
