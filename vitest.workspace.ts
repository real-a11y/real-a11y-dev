import { defineWorkspace } from "vitest/config";

export default defineWorkspace([
  "packages/core",
  "packages/ui",
  "packages/inspector",
  "packages/testing",
  "packages/react",
  "packages/storybook-addon",
  "packages/extension",
]);
