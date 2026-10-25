import path from "path";

import { defineConfig } from "tsup";

import { buildInlineStyles } from "../ui/src/styles/inline.js";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // The `noExternal` below was only ever half the job. Both packages there are
  // PRIVATE, so the declarations have to be inlined as well — `dts: true` alone
  // emits `from "@real-a11y-dev/core"`, which npm cannot resolve.
  //
  // `core` needs it today: `index.ts` imports `SemanticNode`, `TreeViewMode`,
  // `ActionRequest`, `ActionResult`, `ExtractionResult` and
  // `SemanticNavigatorConfig` from it, and several reach the mount options.
  // `semantic-navigator-ui` is latent — nothing from it surfaces right now —
  // but it has been private since #301 and the pairing is what keeps the day
  // one does surface from being a silent `any`.
  dts: {
    resolve: ["@real-a11y-dev/core", "@real-a11y-dev/semantic-navigator-ui"],
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
  noExternal: ["@real-a11y-dev/core", "@real-a11y-dev/semantic-navigator-ui"],
  external: ["preact"],
  define: {
    // Minified here: nothing minifies a string literal later.
    __SN_STYLES__: JSON.stringify(buildInlineStyles()),
  },
  esbuildOptions(options) {
    options.alias = {
      "@real-a11y-dev/core": path.resolve(__dirname, "../core/dist/index.js"),
    };
  },
});
