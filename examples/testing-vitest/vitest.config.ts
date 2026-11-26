import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/setup.ts"],
    // After each run, a11y-snapshots/index.html draws every boxed snapshot
    // (a tree, a tab sequence, an outline, an a11yDiff) as the Semantic
    // Navigator panel does. "default"
    // stays first: listing any reporter replaces Vitest's own output.
    reporters: ["default", "@real-a11y-dev/testing/reporter"],
  },
});
