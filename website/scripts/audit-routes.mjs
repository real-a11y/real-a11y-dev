// Single source of truth for the audited routes / themes / axe rule tags.
// Consumed by:
//   - tests/a11y.spec.ts  (CI gate via @axe-core/playwright + @real-a11y-dev/testing)
// Keeping the list in one file means future ad-hoc scripts (markdown audit
// reports, etc.) can import from here without drifting from the spec.

export const ROUTES = [
  // Top-level
  "/",
  "/accessibility",
  "/privacy",

  // Guide
  "/guide/getting-started",
  "/guide/why",
  "/guide/core-concepts",
  "/guide/accessibility-snapshots",
  "/guide/accessibility-snapshots-comparisons",
  "/guide/architecture",
  "/guide/accessible-names",
  "/guide/panel-features",
  "/guide/understanding-the-views",
  "/guide/reading-the-dom-view",
  "/guide/reading-the-a11y-view",
  "/guide/reading-the-headings-view",
  "/guide/reading-the-tab-view",
  "/guide/chrome-extension",
  "/guide/ci-diff-bot",
  "/guide/authenticated-pages",
  "/guide/troubleshooting",

  // Packages
  "/packages/core",
  "/packages/testing",
  "/packages/testing/snapshots",
  "/packages/testing/assertions",
  "/packages/testing/matchers",
  "/packages/testing/flow",
  "/packages/testing/playwright",
  "/packages/react",
  "/packages/inspector",
  "/packages/storybook-addon",
  "/packages/mcp",
  "/packages/cli",

  // Recipes
  "/recipes/nextjs",
  "/recipes/peer-dependencies",
  "/recipes/storybook-react-19",

  // Examples
  "/examples/vanilla",
  "/examples/react-app",
  "/examples/testing-vitest",
  "/examples/playwright",
  "/examples/storybook",
];

// VitePress respects the OS preference by default. The spec sets
// `colorScheme` on the Playwright context to exercise both — only axe
// cares (contrast tokens differ); the structural a11y tree shouldn't.
export const THEMES = ["light", "dark"];

// WCAG 2.0 / 2.1 / 2.2 Level AA + axe best-practice. Same family the
// surrounding tooling already documents.
export const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];
