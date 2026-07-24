# @real-a11y-dev/semantic-navigator-ui

## 0.1.0-beta.11

### Minor Changes

- c9c5076: Add **diff mode** to the tree view — checkpoint the tree, interact with the page, and see what the interaction actually did to the accessibility tree.

  The toolbar gains a checkpoint button (`⎌`). Pressing it captures the current extraction as a baseline; from then on every re-extraction is diffed against it and rows that **appeared** or **changed** are marked in place, live, as you interact. Pressing it again clears the baseline. This closes the loop the tree view was missing: you could always see the tree, but not what a click did to it.

  Nodes that were **removed** are summarized in a `<details>` below the tree instead of being rendered as rows. Their elements are gone from the DOM, so they have no host element to highlight and no action to dispatch — showing them as tree rows would promise interactivity that cannot exist.

  The indication is not color-only (WCAG 1.4.1): added rows carry a `+` glyph and changed rows a `~`, each paired with visually-hidden text so the status is announced rather than merely seen, and a `forced-colors` fallback trades the tint for a border. While a checkpoint is active the fixed-width marker column is reserved on every row — marked and unmarked alike — so a highlighted label stays aligned with its neighbours instead of being nudged right; the column vanishes when no checkpoint is active, leaving the default view untouched.

  A baseline records the view mode and root it was captured from, and the diff only runs while both still match — dropping it otherwise. An a11y baseline compared against a DOM tree, or a baseline compared against a different root, shares almost no node ids and would report nearly every row as churn.

  New exports: `buildTreeDiffView(baseline, current)` and `EMPTY_DIFF_VIEW`, plus the `TreeDiffView` / `NodeDiffStatus` types. `TreeView` owns the baseline and takes `enableDiff` (default `true`), so surfaces built on it — `@real-a11y-dev/inspector` and the React `SemanticNavigator` — get the button with no change. `TreePanel` is controlled: `enableDiff` defaults to `false` and the host supplies `diff`/`diffActive`/`onToggleDiff`, so the Storybook addon panel is unaffected until it opts in.

  This is the in-page, interaction-scoped diff — it is keyed on live node identity and so does not survive navigation. The navigation-durable, CI-gating diff remains the snapshot fingerprint diff in `@real-a11y-dev/snapshot`.

- 0e7ffc4: Virtualize the `TreePanel` and extension side-panel tree lists so only rows in the viewport plus overscan are rendered, dramatically improving scroll, search, and expand-all performance on large trees. Exposes the new `useVirtualTree` hook for custom tree views.

### Patch Changes

- 35e99e6: Fix three ways the embeddable inspector stopped reacting after mount: a floating `<SemanticNavigator>` rendered an **empty panel** when its root ref was already set (the common `{open && <SemanticNavigator floating />}` toggle), `InspectorInstance.setViewMode()` and the `mode` prop left the rendered tree on the old view while `getTree()` already reported the new one, and `useSemanticTree`/`useActiveModal` never attached to a root that mounted after the first commit and kept observing a **replaced** root. `useSemanticTree` and `useActiveModal` now also accept the element itself (new `SemanticTreeTarget` type) — pass an element from a callback ref when the root mounts late or can be swapped; existing ref-object callers are unchanged.
- 13bacb2: Announce the active row to screen readers in the tree panel. The `role="tree"` container holds focus (its rows are non-focusable `<div>`s), but it never set `aria-activedescendant` and the rows had no `id` — so arrowing through the tree only flipped `aria-selected` on rows the screen reader wasn't tracking, and a screen-reader user heard nothing. Each row now carries a stable `id` and the container points `aria-activedescendant` at the selected row. This flows to every `TreePanel` consumer — the inspector, the React `<SemanticNavigator>`, and the Storybook addon.
- bfec7a0: Add APG first-character / multi-character type-ahead to the panel's composite widgets. Typing printable characters on the focused `role="tree"` or `role="listbox"` container moves selection to a row whose accessible name starts with the typed buffer (500ms idle window; multi-character prefixes keep a still-matching selection; repeating the same letter cycles matches). `/` is reserved for focusing the search input. Covers `useTreeKeyboard` (TreePanel / extension tree) plus FilteredList and TabSequenceView in both the shared UI package and the extension side panel. The README already advertised type-ahead — this makes the claim true. The shared helper is re-exported as `@internal` for the extension forks only (not a versioned public API). Extension InputPanel SelectPicker type-ahead is out of scope. Size budgets: UI 7.8 → 8.4 KB, inspector 30.4 → 31.0 KB gzipped (inspector re-bundles the UI helper).
- Updated dependencies [7f93f92]
- Updated dependencies [6a658fe]
- Updated dependencies [725fcc0]
- Updated dependencies [96cb0ee]
- Updated dependencies [f2532e5]
- Updated dependencies [ad8edc1]
- Updated dependencies [d657f66]
- Updated dependencies [1c8a523]
- Updated dependencies [d693a00]
- Updated dependencies [907c68e]
- Updated dependencies [19e9fc2]
- Updated dependencies [a32632a]
  - @real-a11y-dev/core@0.1.0-beta.11

## 0.1.0-beta.10

### Patch Changes

- Updated dependencies [7a56937]
- Updated dependencies [fcd4bc9]
  - @real-a11y-dev/core@0.1.0-beta.10

## 0.1.0-beta.9

### Patch Changes

- Updated dependencies [3607ac4]
  - @real-a11y-dev/core@0.1.0-beta.9

## 0.1.0-beta.7

### Patch Changes

- Updated dependencies [8c230cb]
- Updated dependencies [c7af39c]
- Updated dependencies [7df0e4d]
- Updated dependencies [088a142]
- Updated dependencies [771f034]
  - @real-a11y-dev/core@0.1.0-beta.7

## 0.1.0-beta.6

### Minor Changes

- 488ca27: Add the DevTools-style element picker to the React inline panel.
  Same UX as the Chrome extension's picker (toolbar `⦿` button +
  `Ctrl/Cmd+Shift+C` shortcut + crosshair cursor + capture-phase
  clicks that `preventDefault` the page handler); when the user
  clicks an element on the host page, the matching tree row is
  selected and scrolled into view.

  Public surface changes:
  - `@real-a11y-dev/core` exports `createPicker(options)` returning
    `{ isEnabled, setEnabled, teardown }`. Moved from
    `@real-a11y-dev/semantic-navigator-extension` (which was private,
    so this is a pure additive export). `SemanticNavigatorConfig`
    gains `enablePicker?: boolean` (default `false`).
  - `@real-a11y-dev/semantic-navigator-ui` — `TreeView`, `TreePanel`,
    and `TreeToolbar` accept `enablePicker` / `pickModeOn` /
    `onTogglePickMode` / `pickedNodeId` / `onPickedNodeHandled`.
    `.sn-pick-btn` styles (shipped earlier with the extension fix in
    PR #81) now have a consumer here too.
  - `@real-a11y-dev/inspector` — `createInspector` reads the new
    `enablePicker` flag from the config and passes it to TreeView.
  - `@real-a11y-dev/react` — `<SemanticNavigator>` gains the matching
    `enablePicker` prop.

  The Chrome extension was already a consumer of `createPicker` and
  now imports it from `@real-a11y-dev/core` instead of its own local
  copy. No behavior change there — same module, same tests, same
  coverage.

  `examples/react-app` flips `enablePicker={true}` so the demo
  surfaces the button. Click `⦿`, hover the page, click any element
  — the panel jumps to the row.

### Patch Changes

- edf86b6: Add `.sn-pick-btn` styles for the DevTools-style element picker toolbar
  button. The button itself is rendered by the extension's sidepanel
  (`packages/extension`, private), but the styles live alongside the
  other toolbar controls (`.sn-curtain-btn`, `.sn-focus-tracker-btn`) so
  any consumer that embeds the same chrome and wants to surface a picker
  toggle gets the matching look for free. Includes hover, focus-visible,
  and `aria-pressed="true"` states.
- a44004c: Add increment/decrement actions for slider and spinbutton rows. The panel
  previously labelled ARIA `[role="slider"]` and `[role="spinbutton"]` as
  TYPE — but typing into a Radix Slider (a `<span role="slider">` that
  listens for arrow keys, not value setters) silently did nothing. Now:
  - `ActionType` gains `"increment"` and `"decrement"` (additive, hence the
    minor bump on `@real-a11y-dev/core`).
  - The dispatcher routes both to a single stepper:
    - Native `<input type="range" | "number">` → `.stepUp()` / `.stepDown()`
      - `input`/`change` events (so frameworks observe the change).
    - Custom ARIA widgets (Radix, Headless UI, etc.) → focus the element +
      dispatch `ArrowRight` / `ArrowLeft` `keydown`+`keyup`. Works under
      the Screen Curtain because the panel drives the value change
      end-to-end without relying on the user seeing the page.
  - `getActions` now exposes:
    - `[role="slider"]` → `focus`, `increment`, `decrement` (drops misleading
      `type`).
    - `[role="spinbutton"]` → `focus`, `type`, `increment`, `decrement`
      (spinbuttons accept typed values too).
    - `<input type="range">` → `focus`, `increment`, `decrement`.
    - `<input type="number">` → `focus`, `type`, `increment`, `decrement`.
  - `TreeNode` renders a paired ▼ ▲ stepper instead of a single primary
    button when both actions are present. Each button dispatches its own
    action via the new optional `action` parameter on `onActivate`.

- Updated dependencies [488ca27]
- Updated dependencies [d583a91]
- Updated dependencies [80dc889]
- Updated dependencies [a44004c]
- Updated dependencies [c2fb61b]
  - @real-a11y-dev/core@0.1.0-beta.6
