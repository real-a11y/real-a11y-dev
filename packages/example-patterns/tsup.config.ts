import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react", "react-dom"],
  // Don't bundle Radix — let consumers' bundlers tree-shake.
  // Radix is in dependencies, so it'll be hoisted to the consumer's
  // node_modules through pnpm.
  noExternal: [],
  target: "es2022",
});
