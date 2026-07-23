import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["spike/**/*.spike.test.ts"],
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});
