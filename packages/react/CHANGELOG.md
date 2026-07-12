# @real-a11y-dev/react

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
