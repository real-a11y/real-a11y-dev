import { defineConfig } from "tsup";

export default defineConfig({
  // `index` is the stdio bin (has a shebang); `server` is the importable API.
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
