import { defineConfig } from "vitest/config";

// Vitest 4 dropped workspace files for `test.projects`. This stays out of the
// `vitest.config.ts` search path on purpose: a root config would be picked up
// by every package without a config of its own (`validate`) and fail them.
// Run it from the root with `pnpm exec vitest --config vitest.workspace.ts`.
export default defineConfig({
  test: {
    projects: [
      "packages/core",
      "packages/ui",
      "packages/inspector",
      "packages/testing",
      "packages/react",
      "packages/storybook-addon",
      "packages/extension",
    ],
  },
});
