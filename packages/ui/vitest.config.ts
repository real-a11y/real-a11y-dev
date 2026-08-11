import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["../vitest.setup.jsdom.ts"],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
});
