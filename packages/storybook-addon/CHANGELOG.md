# @real-a11y-dev/storybook-addon

## 0.1.0-beta.10

### Patch Changes

- Updated dependencies [d8eaaf7]
- Updated dependencies [7a56937]
- Updated dependencies [fcd4bc9]
  - @real-a11y-dev/testing@0.1.0-beta.10
  - @real-a11y-dev/core@0.1.0-beta.10
  - @real-a11y-dev/semantic-navigator-ui@0.1.0-beta.10

## 0.1.0-beta.9

### Patch Changes

- Re-release so the bundled `@real-a11y-dev/core` picks up the modal-dialog scoping fix (#107 — only pivot to genuinely modal dialogs, not any `role="dialog"`). Both packages inline core at build time (`tsup` `noExternal`), so a rebuild is required to ship the fix — a version-only bump of core wouldn't reach them.
- Updated dependencies [3607ac4]
  - @real-a11y-dev/core@0.1.0-beta.9
  - @real-a11y-dev/testing@0.1.0-beta.9
  - @real-a11y-dev/semantic-navigator-ui@0.1.0-beta.9

## 0.1.0-beta.7

### Patch Changes

- Updated dependencies [8c230cb]
- Updated dependencies [c7af39c]
- Updated dependencies [7df0e4d]
- Updated dependencies [088a142]
- Updated dependencies [771f034]
- Updated dependencies [7df0e4d]
- Updated dependencies [194b6ad]
- Updated dependencies [1270667]
  - @real-a11y-dev/core@0.1.0-beta.7
  - @real-a11y-dev/testing@0.1.0-beta.7
  - @real-a11y-dev/semantic-navigator-ui@0.1.0-beta.7

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
