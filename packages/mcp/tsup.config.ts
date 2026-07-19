import { defineConfig } from "tsup";

export default defineConfig({
  // `index` is the stdio bin (has a shebang); `server` is the importable API.
  // The browser session now lives in @real-a11y-dev/browser (imported by both
  // the CLI and this server), so it is no longer built or re-exported here.
  entry: ["src/index.ts", "src/server.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // playwright is a peer dep, resolved by the host — never bundle it.
  external: ["playwright"],
  banner: { js: "" },
});
