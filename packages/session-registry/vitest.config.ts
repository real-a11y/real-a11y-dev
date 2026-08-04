import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Browserless: the registry schedules SessionLike objects as data; the
    // real-browser paths live in the CLI daemon E2E suite.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
