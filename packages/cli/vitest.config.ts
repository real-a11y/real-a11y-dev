import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Fast, browserless unit tests over the pure modules (sanitize,
    // fingerprint, url-gate, args, renderers). The real-browser suite lives in
    // e2e/ and runs via `pnpm test:e2e`.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
