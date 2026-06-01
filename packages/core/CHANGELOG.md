# @real-a11y-dev/core

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

### Patch Changes

- d583a91: Fix the inspector failing to pivot scope onto modal dialogs that don't carry `aria-modal="true"`. Radix Dialog ≥1.1 (and several other modern libs — Headless UI, Reach UI) intentionally omit `aria-modal` and enforce modality via sibling-`aria-hidden` + focus trap instead. `findActiveModal` only matched `[aria-modal="true"]` and `dialog:modal`, so a Radix-style dialog opened in the page produced no pivot — the panel kept showing the underlying chrome instead of the dialog content. The selector now also matches visible `[role="dialog"]` and `[role="alertdialog"]` elements; the existing `isActuallyVisible` ancestor-chain check still filters out closed/unmounted dialogs.
- 80dc889: Fix the inspector missing portal-mounted overlays (Radix Dialog / DropdownMenu / Toast, Headless UI, Vue Teleport, etc.). The `DomObserver` only watched the configured root, and the extractor only pivoted scope when a modal was active — so portals rendered into `document.body` (modals, dropdown menus, listbox popovers, tooltips, and live-region toasts) triggered no mutation event and never joined the tree. A second observer now watches `document.body` at top level only and re-extracts on portal mounts; `extractDomTree` resolves the effective root in three priority levels — active modal (exclusive scope) > portal overlay outside root (pivot to `body`) > configured root. Selector covers `[aria-modal="true"]`, `<dialog>`, `[role="dialog"|"alertdialog"|"menu"|"menubar"|"listbox"|"tooltip"|"status"|"alert"|"log"]`, and `[aria-live]`. Bounded surface — non-overlay body mounts (analytics divs, script tags) don't trigger re-extracts.
- c2fb61b: Stop treeitem / menuitem / option / etc. accessible-name computation
  from concatenating every nested row's text. The previous walker
  recursed into all descendants for name-from-content, so a tree shaped
  like

  ```html
  <li role="treeitem">
    Reports
    <ul role="group">
      <li role="treeitem">report-1</li>
      <li role="treeitem">report-2 …</li>
    </ul>
  </li>
  ```

  reported the outer treeitem's name as `"Reports report-1 report-2
…"` — visible in the inspector panel on the WAI-ARIA APG Tree View
  example surfaced by PR #80. Real assistive tech reads only `"Reports"`
  for that row; each nested treeitem is a sibling with its own
  announceable name.

  Adds a `NAME_BARRIER_ROLES` set used while walking children for
  `computeAccessibleName` and `computeAccessibleDescription`. Subtrees
  whose computed role is a container (`group`, `list`, `menu`, `tree`,
  `listbox`, `tablist`, `toolbar`, `treegrid`, `grid`, `table`,
  `rowgroup`, `combobox`), a self-named row/item widget (`treeitem`,
  `menuitem*`, `option`, `tab`, `listitem`, `row`, `cell`, `gridcell`,
  `columnheader`, `rowheader`), an interactive widget (`button`, `link`,
  `checkbox`, `radio`, `switch`, `slider`, `spinbutton`, `textbox`,
  `searchbox`), or a display/live-region widget (`dialog`,
  `alertdialog`, `tabpanel`, `alert`, `status`, `log`, `tooltip`,
  `progressbar`, `meter`) contribute the empty string.

  Inline formatting roles (`strong`, `emphasis`, `code`, `mark`, etc.)
  and `heading` are intentionally **not** barriers — `<button>Save
<strong>changes</strong></button>` keeps its full label, and a
  `<button><h3>…</h3></button>` card-style trigger still picks up the
  heading text.
