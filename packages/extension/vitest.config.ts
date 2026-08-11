import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["../vitest.setup.jsdom.ts"],
    globals: true,
    include: ["src/**/*.test.ts"],
  },
});
