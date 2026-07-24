# @real-a11y-dev/storybook-addon

## 0.1.0-beta.11

### Minor Changes

- 907c68e: Add `LiveTreeExtractor` for incremental DOM and accessibility tree updates.

  `@real-a11y-dev/core` now exposes a `LiveTreeExtractor` class that keeps the
  previous extraction in memory and re-extracts only the dirty subtrees reported
  by `DomObserver`. It falls back to a full extraction when a mutation can affect
  non-local accessibility state (modal/portal scope, `id`, `aria-labelledby`,
  `aria-describedby`, `for`, etc.). The result is the same `ExtractionResult`
  shape as `extractA11yTree` / `extractDomTree`.

  `DomObserver` callbacks now receive an optional `TreeChange` payload containing
  the accumulated `MutationRecord`s and synthetic dirty roots from `input`/`change`
  events, which `LiveTreeExtractor.refresh(change)` consumes.

  The Chrome extension, React `useSemanticTree` hook, and Storybook addon preview
  have been wired to use `LiveTreeExtractor` so live updates avoid a full page
  re-extraction when only a small region changed.

- f9e35c2: Make Storybook preview extraction lazy: the DomObserver / LiveTreeExtractor only run while the Semantic Navigator panel is open. The manager emits `REQUEST_TREE` on mount and `STOP_TREE` on unmount. After a canvas/iframe reload the preview emits `PREVIEW_READY` so an already-open panel can re-request without listening to every `storyRendered` (which would double-extract). `storyRendered` / `storyChanged` in the preview no longer start the pipeline unconditionally — registering the addon no longer means every Controls-driven or animated story pays full-tree extract + channel `postMessage` cost while you're on another tab. Custom channel listeners that assumed always-on `TREE_UPDATED` should open the panel (or emit `REQUEST_TREE`) to start receiving updates.

### Patch Changes

- Updated dependencies [1d0eef0]
- Updated dependencies [7f93f92]
- Updated dependencies [6a658fe]
- Updated dependencies [cafe048]
- Updated dependencies [725fcc0]
- Updated dependencies [e2eca34]
- Updated dependencies [96cb0ee]
- Updated dependencies [7a9b870]
- Updated dependencies [f2532e5]
- Updated dependencies [ad8edc1]
- Updated dependencies [d657f66]
- Updated dependencies [1c8a523]
- Updated dependencies [acb8931]
- Updated dependencies [17f8df4]
- Updated dependencies [d693a00]
- Updated dependencies [35e99e6]
- Updated dependencies [907c68e]
- Updated dependencies [7d8324d]
- Updated dependencies [1a3d813]
- Updated dependencies [19e9fc2]
- Updated dependencies [a32632a]
- Updated dependencies [a12e7f2]
- Updated dependencies [e2df9ec]
- Updated dependencies [beae032]
- Updated dependencies [0a7a821]
- Updated dependencies [13bacb2]
- Updated dependencies [bfec7a0]
- Updated dependencies [c9c5076]
- Updated dependencies [0e7ffc4]
  - @real-a11y-dev/testing@0.1.0-beta.11
  - @real-a11y-dev/core@0.1.0-beta.11
  - @real-a11y-dev/semantic-navigator-ui@0.1.0-beta.11

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
