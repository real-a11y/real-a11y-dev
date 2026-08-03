import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  // ESM only: both consumers (cli, mcp) are ESM and bundle this package into
  // their own dists — there is no npm consumer to need CJS.
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
