# @real-a11y-dev/storybook-addon

## 0.1.0-beta.6

### Patch Changes

- cdb26ca: Fix the Storybook addon reporting "Empty tree" (and missing live state
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

- Updated dependencies [488ca27]
- Updated dependencies [edf86b6]
- Updated dependencies [d583a91]
- Updated dependencies [80dc889]
- Updated dependencies [a44004c]
- Updated dependencies [c2fb61b]
  - @real-a11y-dev/core@0.1.0-beta.6
  - @real-a11y-dev/semantic-navigator-ui@0.1.0-beta.6
  - @real-a11y-dev/testing@0.1.0-beta.6
