import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["spike/**/*.spike.test.ts"],
    // The desktop-navigator spike has its own dedicated command
    // (test:spike:desktop) — exclude it here so the heavy headless-browser +
    // panel-server flow isn't also swept into the general spike run.
    exclude: ["spike/desktop-navigator/**"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
