import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["../vitest.setup.jsdom.ts"],
    globals: true,
    include: ["src/**/*.test.{ts,tsx}"],
  },
  // The panel is Preact, and `.tsx` suites are collected, so the automatic
  // runtime has to be configured here the way `ui` and `inspector` do it —
  // vitest does not inherit the `jsx` settings from `tsconfig.json`.
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
});
