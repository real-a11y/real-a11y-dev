# @real-a11y-dev/semantic-navigator-ui

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
