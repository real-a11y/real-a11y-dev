# @real-a11y-dev/react

## 0.1.0-beta.11

### Minor Changes

- 35e99e6: Fix three ways the embeddable inspector stopped reacting after mount: a floating `<SemanticNavigator>` rendered an **empty panel** when its root ref was already set (the common `{open && <SemanticNavigator floating />}` toggle), `InspectorInstance.setViewMode()` and the `mode` prop left the rendered tree on the old view while `getTree()` already reported the new one, and `useSemanticTree`/`useActiveModal` never attached to a root that mounted after the first commit and kept observing a **replaced** root. `useSemanticTree` and `useActiveModal` now also accept the element itself (new `SemanticTreeTarget` type) — pass an element from a callback ref when the root mounts late or can be swapped; existing ref-object callers are unchanged.
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

### Patch Changes

- 9a16451: Fix `<SemanticNavigator>` freezing inspector config props after mount. `theme`, `interactive`, `highlightOnHover`, `scrollHostOnSelect`, `focusHostOnActivate`, and `enablePicker` now remount when they change (they were closed over in an effect that only depended on root/mount/host). `onNodeSelect` / `onAction` use ref-backed stable wrappers so a parent that recreates the callback each render always invokes the latest closure — previously handlers read stale state indefinitely. The misleading "updated imperatively below" comment is gone; only `mode` still updates via `setViewMode` without remounting. (`styleNonce` remains mount-only — the inspector reuses the host's shadow root and injects the stylesheet once.)
- Updated dependencies [7f93f92]
- Updated dependencies [6a658fe]
- Updated dependencies [725fcc0]
- Updated dependencies [96cb0ee]
- Updated dependencies [f2532e5]
- Updated dependencies [ad8edc1]
- Updated dependencies [d657f66]
- Updated dependencies [1c8a523]
- Updated dependencies [d693a00]
- Updated dependencies [35e99e6]
- Updated dependencies [c9c5076]
- Updated dependencies [907c68e]
- Updated dependencies [19e9fc2]
- Updated dependencies [a32632a]
  - @real-a11y-dev/core@0.1.0-beta.11
  - @real-a11y-dev/inspector@0.1.0-beta.11

## 0.1.0-beta.10

### Patch Changes

- Updated dependencies [7a56937]
- Updated dependencies [fcd4bc9]
  - @real-a11y-dev/core@0.1.0-beta.10
  - @real-a11y-dev/inspector@0.1.0-beta.9

## 0.1.0-beta.9

### Patch Changes

- Updated dependencies [3607ac4]
- Updated dependencies
  - @real-a11y-dev/core@0.1.0-beta.9
  - @real-a11y-dev/inspector@0.1.0-beta.9

## 0.1.0-beta.8

### Patch Changes

- Updated dependencies
  - @real-a11y-dev/inspector@0.1.0-beta.8

## 0.1.0-beta.7

### Patch Changes

- Updated dependencies [8c230cb]
- Updated dependencies [c7af39c]
- Updated dependencies [7df0e4d]
- Updated dependencies [088a142]
- Updated dependencies [771f034]
  - @real-a11y-dev/core@0.1.0-beta.7
  - @real-a11y-dev/inspector@0.1.0-beta.6

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

- Updated dependencies [488ca27]
- Updated dependencies [d583a91]
- Updated dependencies [80dc889]
- Updated dependencies [a44004c]
- Updated dependencies [c2fb61b]
  - @real-a11y-dev/core@0.1.0-beta.6
  - @real-a11y-dev/inspector@0.1.0-beta.6
