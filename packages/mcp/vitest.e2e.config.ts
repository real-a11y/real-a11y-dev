import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Real-browser end-to-end suite — launches Chromium, so give it headroom
    // and keep it out of the default `test` run.
    environment: "node",
    include: ["e2e/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
