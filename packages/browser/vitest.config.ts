import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Browserless unit tests over the Node-side surface (URL gating, option
    // shaping). The real-Chromium paths are exercised by the CLI/MCP e2e.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
