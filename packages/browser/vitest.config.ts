import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Browserless unit tests over the Node-side surface (URL gating, option
    // shaping). The real-Chromium paths are exercised by the CLI/MCP e2e.
    // `e2e/parity.test.ts` tests the parity harness's line normalizer, which
    // needs no browser; it runs here so a required check covers it, where the
    // e2e suite is advisory.
    environment: "node",
    include: ["src/**/*.test.ts", "e2e/parity.test.ts"],
  },
});
