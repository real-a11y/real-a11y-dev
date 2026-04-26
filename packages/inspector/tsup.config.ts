import { defineConfig } from "tsup";
import path from "path";
import fs from "fs";

const stylesDir = path.resolve(__dirname, "../ui/src/styles");
const treeCSS = fs.readFileSync(path.join(stylesDir, "tree.css"), "utf-8");
const themesCSS = fs.readFileSync(path.join(stylesDir, "themes.css"), "utf-8");
const allCSS = JSON.stringify(themesCSS + "\n" + treeCSS);

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
  noExternal: ["@real-a11y-dev/core", "@real-a11y-dev/semantic-navigator-ui"],
  external: ["preact"],
  define: {
    __SN_STYLES__: allCSS,
  },
  esbuildOptions(options) {
    options.alias = {
      "@real-a11y-dev/core": path.resolve(__dirname, "../core/dist/index.js"),
    };
  },
});
