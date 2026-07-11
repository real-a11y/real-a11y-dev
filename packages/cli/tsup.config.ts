import { defineConfig } from "tsup";

export default defineConfig({
  // `index` is the bin (has a shebang); `api` is the importable pure surface
  // (fingerprints + types — no browser, no playwright).
  entry: ["src/index.ts", "src/api.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  // playwright is an (optional) peer dep, resolved by the host — never bundle.
  external: ["playwright"],
  banner: { js: "" },
});
