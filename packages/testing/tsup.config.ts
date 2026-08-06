import { defineConfig } from "tsup";

export default defineConfig({
  // ESM + CJS entries. The injected IIFE page-bundle now lives in
  // @real-a11y-dev/browser; the Playwright adapter resolves it from there.
  entry: [
    "src/index.ts",
    "src/playwright.ts",
    "src/matchers.ts",
    "src/matchers-vitest.ts",
  ],
  format: ["esm", "cjs"],
  // `@real-a11y-dev/validate` is a PRIVATE workspace package — npm can never
  // resolve it, so it is bundled here and declared as a devDependency. Both
  // halves are needed: `noExternal` inlines the JS, `dts.resolve` inlines the
  // declarations. Without the second, the emitted `.d.ts` would keep
  // `from "@real-a11y-dev/validate"` and a consumer would get `TS2307` — or,
  // with `skipLibCheck: true`, types silently degrading to `any`. `surface:check`
  // fails on exactly that, so this is enforced rather than remembered.
  noExternal: ["@real-a11y-dev/validate"],
  dts: { resolve: ["@real-a11y-dev/validate"] },
  sourcemap: true,
  clean: true,
  treeshake: true,
});
