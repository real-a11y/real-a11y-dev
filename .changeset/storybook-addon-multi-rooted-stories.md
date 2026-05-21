---
"@real-a11y-dev/storybook-addon": patch
---

Fix the Storybook addon reporting "Empty tree" (and missing live state
updates) for stories that render multiple sibling root elements. The
previous root picker used `firstElementChild` of `#storybook-root`,
which lands on React Aria's collection-builder `<template>` for
patterns like `<Tree>`, `<ListBox>`, and `<ComboBox>` — the extractor
walked an empty subtree and the `DomObserver` scoped to that template
never fired re-extracts on selection changes.

`getStoryRoot` (now a pure `pickStoryRoot(doc)` helper for testability)
filters out non-rendered tags (`<template>`, `<script>`, `<style>`,
`<noscript>`) when deciding the root:

- **Exactly one real child** → use it (preserves the clean tree for
  plain single-root stories like `<Button>`).
- **Zero or 2+ real children** → use `#storybook-root` itself so the
  observer sees all siblings (React Aria patterns, React Portal
  hoisting, empty mid-render, etc.).

Adds 8 regression tests in `pick-story-root.test.ts` covering each
branch.
