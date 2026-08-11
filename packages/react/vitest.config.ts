import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["../vitest.setup.jsdom.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    globals: true,
  },
  esbuild: {
    jsx: "automatic",
  },
});
