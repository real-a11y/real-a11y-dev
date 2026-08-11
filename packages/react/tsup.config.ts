import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm", "cjs"],
  // `@real-a11y-dev/core` is a PRIVATE workspace package, so it is bundled in
  // and held as a devDependency — a published `dependencies` entry would break
  // every install. Both halves are required: `noExternal` inlines the JS,
  // `dts.resolve` inlines the declarations. Without the second, the emitted
  // `.d.ts` keeps `from "@real-a11y-dev/core"` and a consumer gets `TS2307` —
  // or, under the common `skipLibCheck: true`, types silently degrading to
  // `any`, which no build step reports.
  //
  // This package needs both for real, not defensively: `index.ts` re-exports
  // core's `SemanticNode` and friends, and `useActiveModal` imports the VALUE
  // `findByRole`, not just types.
  //
  // `@real-a11y-dev/inspector` stays external — it is published, so npm can
  // resolve it.
  dts: { resolve: ["@real-a11y-dev/core"] },
  noExternal: ["@real-a11y-dev/core"],
  sourcemap: true,
  clean: true,
  treeshake: true,
  external: ["react", "react-dom"],
});
