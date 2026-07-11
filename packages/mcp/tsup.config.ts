import { defineConfig } from "tsup";

export default defineConfig({
  // `index` is the stdio bin (has a shebang); `server` is the importable API;
  // `browser` is the standalone session surface (the `./browser` subpath) for
  // consumers like the CLI that must not load the MCP SDK graph.
  entry: ["src/index.ts", "src/server.ts", "src/browser.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // playwright is a peer dep, resolved by the host — never bundle it.
  external: ["playwright"],
  banner: { js: "" },
});
