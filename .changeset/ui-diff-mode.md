---
"@real-a11y-dev/semantic-navigator-ui": minor
---

Add **diff mode** to the tree view — checkpoint the tree, interact with the page, and see what the interaction actually did to the accessibility tree.

The toolbar gains a checkpoint button (`⎌`). Pressing it captures the current extraction as a baseline; from then on every re-extraction is diffed against it and rows that **appeared** or **changed** are marked in place, live, as you interact. Pressing it again clears the baseline. This closes the loop the tree view was missing: you could always see the tree, but not what a click did to it.

Nodes that were **removed** are summarized in a `<details>` below the tree instead of being rendered as rows. Their elements are gone from the DOM, so they have no host element to highlight and no action to dispatch — showing them as tree rows would promise interactivity that cannot exist.

The indication is not color-only (WCAG 1.4.1): added rows carry a `+` glyph and changed rows a `~`, each paired with visually-hidden text so the status is announced rather than merely seen, and a `forced-colors` fallback trades the tint for a border.

A baseline records the view mode and root it was captured from, and the diff only runs while both still match — dropping it otherwise. An a11y baseline compared against a DOM tree, or a baseline compared against a different root, shares almost no node ids and would report nearly every row as churn.

New exports: `buildTreeDiffView(baseline, current)` and `EMPTY_DIFF_VIEW`, plus the `TreeDiffView` / `NodeDiffStatus` types. `TreeView` owns the baseline and takes `enableDiff` (default `true`), so surfaces built on it — `@real-a11y-dev/inspector` and the React `SemanticNavigator` — get the button with no change. `TreePanel` is controlled: `enableDiff` defaults to `false` and the host supplies `diff`/`diffActive`/`onToggleDiff`, so the Storybook addon panel is unaffected until it opts in.

This is the in-page, interaction-scoped diff — it is keyed on live node identity and so does not survive navigation. The navigation-durable, CI-gating diff remains the snapshot fingerprint diff in `@real-a11y-dev/snapshot`.
