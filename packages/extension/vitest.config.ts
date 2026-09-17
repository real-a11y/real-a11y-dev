import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["../vitest.setup.jsdom.ts"],
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
  // The panel is Preact. Declared rather than discovered: Vite does hand this
  // package's `tsconfig.json` (`jsx: react-jsx`, `jsxImportSource: preact`) to
  // esbuild, so `.tsx` suites transform correctly without this block — it is
  // here because `ui`, `inspector` and `react` all state it explicitly, and
  // because a config that says which runtime it wants does not quietly change
  // meaning if tsconfig resolution ever does. Divergence between these configs
  // is what let `.tsx` suites go uncollected here in the first place.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
});
