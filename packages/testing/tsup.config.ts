import { defineConfig } from "tsup";

export default defineConfig({
  // ESM + CJS entries. The injected IIFE page-bundle now lives in
  // @real-a11y-dev/browser; the Playwright adapter resolves it from there.
  entry: [
    "src/index.ts",
    "src/playwright.ts",
    "src/matchers.ts",
    "src/matchers-vitest.ts",
    "src/matchers-jest.ts",
    "src/matchers-jest-globals.ts",
  ],
  format: ["esm", "cjs"],
  // `@real-a11y-dev/validate` is a PRIVATE workspace package — npm can never
  // resolve it, so it is bundled here and declared as a devDependency. Both
  // halves are needed: `noExternal` inlines the JS, `dts.resolve` inlines the
  // declarations. Without the second, the emitted `.d.ts` would keep
  // `from "@real-a11y-dev/validate"` and a consumer would get `TS2307` — or,
  // with `skipLibCheck: true`, types silently degrading to `any`. `surface:check`
  // fails on exactly that, so this is enforced rather than remembered.
  noExternal: [
    "@real-a11y-dev/validate",
    "@real-a11y-dev/audit",
    "@real-a11y-dev/serialize",
    "@real-a11y-dev/browser",
    "@real-a11y-dev/core",
  ],
  dts: {
    resolve: [
      "@real-a11y-dev/validate",
      // `core` is PRIVATE too now, and unlike the others its types are all over
      // this package's surface — `SemanticNode`, `ExtractionResult`, `TreeDiff`
      // and `NodeChange` are what these helpers take and return, in `capture`,
      // `diff`, `change-spec` and `dispatch`. Nothing useful would be left of
      // the published types without this.
      "@real-a11y-dev/core",
      // `testing` re-exports audit's `Finding` / `A11yRule` / `ALL_RULES` and
      // serialize's `SerializeOptions` / `extract` — with both private, those
      // are now the ONLY published home for that vocabulary, so the
      // declarations must carry them rather than point at a 404.
      "@real-a11y-dev/audit",
      "@real-a11y-dev/serialize",
      // Paired with the `noExternal` above. Latent today — no browser type
      // reaches this package's public surface — but the pairing is what the
      // architecture page promises, and the day one does the emit would name
      // an unresolvable specifier.
      "@real-a11y-dev/browser",
    ],
  },
  sourcemap: true,
  clean: true,
  treeshake: true,
});
