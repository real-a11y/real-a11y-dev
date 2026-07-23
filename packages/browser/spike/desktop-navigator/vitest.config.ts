import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["spike/desktop-navigator/**/*.spike.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
