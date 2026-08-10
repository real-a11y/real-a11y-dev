import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["../vitest.setup.jsdom.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  esbuild: {
    jsx: "automatic",
    jsxImportSource: "preact",
  },
  define: {
    __SN_STYLES__: JSON.stringify(
      "/* styles stubbed in tests */ .sn-test-marker { color: red; }",
    ),
  },
});
