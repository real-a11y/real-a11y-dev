import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Browserless: the engine operates on findings/artifacts/diffs as data,
    // never on a live DOM. The real-browser paths live in the CLI/MCP e2e.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
