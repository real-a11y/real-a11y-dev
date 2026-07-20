---
"@real-a11y-dev/semantic-navigator-ui": minor
---

Add **diff mode** to the tree view — checkpoint the tree, interact with the page, and see what the interaction actually did to the accessibility tree.

The toolbar gains a checkpoint button (`⎌`). Pressing it captures the current extraction as a baseline; from then on every re-extraction is diffed against it and rows that **appeared** or **changed** are marked in place, live, as you interact. Pressing it again clears the baseline. This closes the loop the tree view was missing: you could always see the tree, but not what a click did to it.

Nodes that were **removed** are summarized in a `<details>` below the tree instead of being rendered as rows. Their elements are gone from the DOM, so they have no host element to highlight and no action to dispatch — showing them as tree rows would promise interactivity that cannot exist.

The indication is not color-only (WCAG 1.4.1): added rows carry a `+` glyph and changed rows a `~`, each paired with visually-hidden text so the status is announced rather than merely seen, and a `forced-colors` fallback trades the tint for a border. Switching between DOM and A11Y view drops the baseline — they are different extractions, so a checkpoint taken in one is not comparable against the other.

New exports: `buildTreeDiffView(baseline, current)` and `EMPTY_DIFF_VIEW`, plus the `TreeDiffView` / `NodeDiffStatus` types, for hosts that want to drive the baseline themselves. `TreeView` takes `enableDiff` (default `true`); `TreePanel` takes the derived `diff` view as a prop.

This is the in-page, interaction-scoped diff — it is keyed on live node identity and so does not survive navigation. The navigation-durable, CI-gating diff remains the snapshot fingerprint diff in `@real-a11y-dev/snapshot`.
