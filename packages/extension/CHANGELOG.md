# @real-a11y-dev/semantic-navigator-extension

<!--
  Maintained by hand. The extension is `private` and is excluded from
  Changesets (see `ignore` in `.changeset/config.json`), so it gets no
  auto-generated changelog. When you bump the extension's version at
  release time, add the matching entry here. Entries reference the PR that
  landed the change; versions match `package.json`/`public/manifest.json`.
-->

## Unreleased

### Patch Changes

- Fix nested iframes disappearing from the tree when a nested frame's
  content script announced before its parent's. Child frames are now
  merged parent-first, so a grandchild frame's subtree is always attached
  under its parent iframe regardless of announce order. ([#151])
- Refresh the side panel when a page is restored from the back/forward
  cache. Previously, pressing Back left the panel showing the page you
  navigated away from — and because node ids are reused across pages,
  clicking a row could fire an action on the wrong element on the restored
  page. The panel now re-syncs to the restored page. ([#161])
- Clean up the panel's on-page state on **every** tab when the side panel
  closes, not just the active one. Previously a background tab kept its
  screen curtain (with no UI to dismiss it) and kept drawing focus overlays
  after the panel was gone. ([#168])
- Open the panel's inline text-entry box for **custom contenteditable text
  widgets** — an ARIA `textbox`/`combobox`/`searchbox` built as a
  `contenteditable` `<div>` (Slack's message box and search, Notion, Google
  Docs, and other Quill/ProseMirror/Lexical editors). Double-clicking one
  previously did nothing because the field-state read only understood native
  `<input>`/`<textarea>`/`<select>`; it now also reads contenteditable hosts
  (current text via `textContent`, never revealing a secret). Note the
  actual text insertion into model-driven editors remains best-effort — see
  `ActionDispatcher`. ([#178])
- Keep the panel's tree in sync incrementally instead of re-walking the whole
  page on every DOM change. Typing into a field or a small widget update now
  re-extracts only the affected subtree, which keeps the panel responsive on
  large pages. Changes that can move what the tree is scoped to — a modal
  opening or closing, a portal mounting — still fall back to a full
  re-extraction, so the panel keeps matching what a screen reader sees.
  ([#182])

- Add a **Load tree** button to the "Connecting to page…" screen. Switching
  tabs clears the tree and drops the panel into that disconnected state, but
  the toolbar's refresh button only renders in the connected UI — so the
  documented recovery path was unreachable and the panel healed only if the
  new page happened to mutate its DOM (or you reloaded it). ([#192])
- Stop hovering panel rows from scrolling the page and moving real focus.
  Hover and selection shared one `HIGHLIGHT_NODE` message, so sweeping the
  pointer down the tree scroll-jumped the host page and fired its own
  focus/blur handlers — flyout menus, validation — once per row crossed.
  Hover is now a preview: overlay only, no scroll, no focus change. Click and
  arrow-key selection still scroll to and focus the element. ([#192])

- Make the panel's four keyboard-navigable lists announce their active row
  to screen readers. The tree, the filtered-role list, the tab-sequence view,
  and the select picker all keep DOM focus on the `role="tree"`/`"listbox"`
  container while arrow keys move an `aria-selected` highlight between
  non-focusable rows — but without `aria-activedescendant` a screen reader
  never learns which row is active, so arrowing announced nothing. Each row
  now has a stable id and its container points `aria-activedescendant` at it.
  ([#194])

## 0.1.7

### Patch Changes

- Validate the sender of every runtime message so the content-script
  handlers only act on messages from this extension's own contexts. ([#127])
- Extract and observe the page only while the side panel is connected,
  so a tab whose panel was never opened does no extraction work. ([#120])

## 0.1.6

### Patch Changes

- Maintenance release: picks up updated `@real-a11y-dev/core` and
  `@real-a11y-dev/semantic-navigator-ui` engines. No extension-specific
  changes.

## 0.1.5

### Minor Changes

- Copy the accessibility tree to the clipboard as Markdown from the side
  panel. ([#102])

### Patch Changes

- Redact sensitive form-field values (e.g. password and other secret-
  bearing inputs) at the extraction source, so they never reach the panel
  or any export. ([#103])

## 0.1.4

### Minor Changes

- Add a DevTools-style element picker: the toolbar `⦿` button (or
  `Ctrl`/`Cmd`+`Shift`+`C`) turns on a crosshair; clicking an element on the
  page selects and scrolls to its row in the tree. ([#81])

## 0.1.3

Earlier releases predate this changelog.

[#81]: https://github.com/real-a11y/real-a11y-dev/pull/81
[#102]: https://github.com/real-a11y/real-a11y-dev/pull/102
[#103]: https://github.com/real-a11y/real-a11y-dev/pull/103
[#120]: https://github.com/real-a11y/real-a11y-dev/pull/120
[#127]: https://github.com/real-a11y/real-a11y-dev/pull/127
[#151]: https://github.com/real-a11y/real-a11y-dev/pull/151
[#161]: https://github.com/real-a11y/real-a11y-dev/pull/161
[#168]: https://github.com/real-a11y/real-a11y-dev/pull/168
[#178]: https://github.com/real-a11y/real-a11y-dev/pull/178
[#182]: https://github.com/real-a11y/real-a11y-dev/pull/182
[#192]: https://github.com/real-a11y/real-a11y-dev/pull/192
[#194]: https://github.com/real-a11y/real-a11y-dev/pull/194
