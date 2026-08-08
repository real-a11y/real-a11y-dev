# @real-a11y-dev/inspector

## 0.1.0-beta.13

### Patch Changes

- 80d2b02: Halve the tree-search work done per keystroke. `applySearchFilter` ran the match predicate over the whole tree twice — once inside `searchTree` to build the visible set, then again to count the direct matches — so every character typed into the panel's search box paid for the string matching and `Object.entries` allocation of both passes. The two are now collected in one pass, and the loop that writes `ui.matchesFilter` folds the counting in rather than iterating the tree a second time.

  `searchTree`'s ancestor-marking walk also climbed all the way to the root for every match, re-adding ids it had already marked: O(matches × depth) on a deep tree where the matches share a path. It now stops at the first ancestor already in the set, which is one climb per distinct path segment instead of one per match (and terminates rather than spinning if a malformed tree's `parentId` links form a cycle).

  Behaviour is unchanged — same visible set, same direct-match count. This is the extraction/counting cost only; the panel still filters synchronously on each keystroke, with no input debounce.

## 0.1.0-beta.12

### Patch Changes

- 489cd82: Wire `TreeView` to `LiveTreeExtractor` so inspector / `<SemanticNavigator>` live updates re-extract only dirty subtrees. Previously `TreeView` ignored the `DomObserver` `TreeChange` payload and called `extractA11yTree` / `extractDomTree` on every flush — the residual of audit finding #50 after #182 landed the incremental path for the extension, `useSemanticTree`, and the Storybook preview. Each flush now snapshots the result Map so a diff checkpoint baseline cannot be mutated by a later incremental splice. Inspector is re-released because it bundles the UI package (size budget 31 → 32.5 KB gzipped — TreeView now pulls LiveTreeExtractor into the inspector bundle).
- 96aee1f: Preserve the user's tree expand/collapse across live DomObserver updates. `TreeView` (inspector / `<SemanticNavigator>`) and the Storybook manager panel now run `preserveExpandedState` before adopting a new extraction — without it, a11y-mode rebuilds reset every node to the depth heuristic, so a collapse-all (or any deep expand) snapped back on the next host-page mutation. New export: `preserveExpandedState(prev, next)`. Inspector and storybook-addon are re-released because they bundle the UI package (inspector size budget 32.5 → 32.6 KB gzipped).
- 0aa67f4: Let keyboard users decrement sliders/spinbuttons. The ▼/▲ stepper buttons are mouse-only (`tabIndex={-1}`), and Enter always hit `getPrimaryAction` which prefers `increment` — so a keyboard-only panel user could raise a value but never lower it. `+`/`=` now increment, `-`/`_` and `Shift+Enter` decrement (tree + form filtered list).
- a67fd38: fix(ui): silence the benign "ResizeObserver loop completed with undelivered notifications" warning from the virtualized tree. The observer's re-measure now defers to a single `requestAnimationFrame`, breaking the synchronous observe→setState→relayout loop that Chromium reports (and which showed up in the extension's Errors panel). No behavior change to virtualization.

## 0.1.0-beta.11

### Patch Changes

- 35e99e6: Fix three ways the embeddable inspector stopped reacting after mount: a floating `<SemanticNavigator>` rendered an **empty panel** when its root ref was already set (the common `{open && <SemanticNavigator floating />}` toggle), `InspectorInstance.setViewMode()` and the `mode` prop left the rendered tree on the old view while `getTree()` already reported the new one, and `useSemanticTree`/`useActiveModal` never attached to a root that mounted after the first commit and kept observing a **replaced** root. `useSemanticTree` and `useActiveModal` now also accept the element itself (new `SemanticTreeTarget` type) — pass an element from a callback ref when the root mounts late or can be swapped; existing ref-object callers are unchanged.
- c9c5076: Stop shipping the stylesheet twice. `__SN_STYLES__` is an esbuild `define`, so **every** occurrence of the identifier was replaced with the entire stylesheet literal at build time — and the inspector read it at two injection sites (shadow root and light DOM). The bundle therefore carried two complete copies of the CSS, which gzip could not fold together because they sit further apart than its window.

  The define is now bound to a module-level constant that both paths read. Behavior is unchanged; the bundle drops by roughly 32 kB raw / 5 kB gzipped.

## 0.1.0-beta.9

### Patch Changes

- Re-release so the bundled `@real-a11y-dev/core` picks up the modal-dialog scoping fix (#107 — only pivot to genuinely modal dialogs, not any `role="dialog"`). Both packages inline core at build time (`tsup` `noExternal`), so a rebuild is required to ship the fix — a version-only bump of core wouldn't reach them.

## 0.1.0-beta.8

### Patch Changes

- Re-release to pick up this cycle's `@real-a11y-dev/core` and `@real-a11y-dev/semantic-navigator-ui` fixes, which the inspector bundles at build time (`noExternal`): aria-labelledby-before-aria-label precedence, the accname self-reference cycle guard, name-from-content for named widgets, sensitive-value redaction, accessible-name normalization, and the element-picker button fix. No inspector API changes — the previously published build shipped the older bundled engine.

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
