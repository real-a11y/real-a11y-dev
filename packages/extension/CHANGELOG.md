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

- Stop the panel sitting on "Connecting to page…" forever on pages where
  Chrome does not allow a content script — `chrome://` pages (the default
  new-tab page among them), the Chrome Web Store, and the built-in PDF
  viewer. The background answered every `REQUEST_TREE` with `success: true`
  before Chrome had run the send callback, so a broadcast that reached no
  frame at all was reported as delivered; the panel's only other signal is a
  tree arriving, which on those pages never happens, and the wait read as a
  bug rather than a platform restriction. The background now answers from
  inside the callback and reports `restricted-page` when the send found no
  receiver, and the panel renders that as "This page can't be inspected"
  with a **Try again** button — kept live because the same reply comes back
  for a content script that has not finished loading. Only a "receiving end
  does not exist" error is reported that way: a `lastError` for a tab that no
  longer exists stays a plain failure, so a re-extract queued just before the
  user closed the tab cannot claim the page was restricted.

- Stop the panel showing the previous page's tree after you navigate. A tree
  only ever reached the panel because some frame announced one, so
  navigating to a page that can run no content script — the Web Store, a
  PDF, a `chrome://` page — left the tree you were last looking at on screen
  indefinitely. That is worse than an empty panel: node ids are a per-frame
  counter, so its rows resolve to unrelated elements on the new page and stay
  clickable. Every top-frame navigation now tells the panel to drop what it
  holds; an ordinary page repopulates it within moments, and one that cannot
  offers **Load tree**, which says so.
- Stop the panel waiting on "Connecting to page…" forever after Chrome has
  restarted the extension's service worker. The merge that publishes a tree
  refused to run without a connected side-panel port — which a worker revived
  by the panel's own request does not yet have — so the tree the content
  script sent back was recorded and never delivered, and nothing retried,
  because a content script re-announces only when its own DOM next mutates. A
  request the panel itself sent is now proof enough of a panel to answer it.
- Give each `<iframe>` on a page its own subtree when several embed the same
  document. Matching a frame to its `<iframe>` compared urls with the query
  string stripped and never recorded which iframes were already spoken for, so
  the usual shape of a repeated embed — ad units, consent frames and social
  widgets differing only by `?id=1` / `?id=2`, or by nothing at all — had every
  frame match the FIRST such iframe and pile in under it, while the second
  iframe rendered empty. Matching now tries the url with its query string
  before falling back to the query-stripped comparison, and an `<iframe>` a
  frame has attached under is no longer offered to any other frame, in the
  fallback pass as well as the url ones.

## 0.1.11

### Patch Changes

- Stop the panel opening an unrelated subtree when focus moves inside an
  iframe. Focus and picker events reached the panel twice — once straight
  from the frame, once relayed by the background with the node id prefixed by
  its frame — and only the relayed id is addressable in the merged tree. The
  direct copy's frame-local `sn-<n>` resolved to a different top-frame node,
  which the panel selected and force-expanded before the relayed copy put the
  selection right; the expansions stayed behind. The panel now ignores the
  direct copy. ([#317])
- Stop iframe content from vanishing from the panel after Chrome restarts the
  extension's service worker. The worker keeps each tab's per-frame trees in
  memory, so a restart loses them — and the page's content scripts, still
  loaded and still observing, re-announce only when their own DOM next
  mutates. The first frame to do so was merged on its own, replacing the
  panel's complete tree with one missing every iframe subtree until each
  other frame happened to change. Once per tab, the background now compares
  the frames Chrome reports against the trees it holds and asks any frame it
  is missing — and could actually be running a content script — to
  re-announce, so the panel is whole again a moment later instead of after an
  arbitrary edit. ([#315])

## 0.1.10

### Patch Changes

- Halve the work the panel's search box does per keystroke. Filtering ran the
  match predicate over the whole tree twice — once to decide what stays
  visible, once to count the matches — and re-climbed to the root for every
  match when marking ancestor paths. Both are now a single pass. The results
  are identical; there is just less to do between the keypress and the
  redraw. ([#308])

## 0.1.9

### Patch Changes

- Let keyboard users lower a slider or spinbutton from the panel. The ▼/▲
  stepper buttons are mouse-only, and Enter always took the widget's primary
  action — which prefers `increment` — so a keyboard-only user could raise a
  value but never lower it. `+`/`=` now increment, `-`/`_` and `Shift+Enter`
  decrement, in both the tree and the role-filtered lists. ([#248])
- Stop the "ResizeObserver loop completed with undelivered notifications"
  warning appearing in the extension's Errors panel. The virtualized tree's
  re-measure now defers to a single animation frame, breaking the synchronous
  observe → setState → relayout loop Chromium reports. Benign before, but it
  buried real errors. No change to how virtualization behaves. ([#244])
- Fix the element picker activating the widget you were trying to inspect.
  Pick mode cancelled only the `click`, so everything leading up to it still
  reached the page — dropdown triggers open on `pointerdown`, focus moves on
  `mousedown` — and picking a menu button opened its menu. The whole pointer
  sequence is now suppressed while the picker is on, the way Chrome's own
  inspect mode behaves. ([#287])

## 0.1.8

### Patch Changes

- Add **type-ahead** to the tree and the role-filtered lists: start typing a
  role or accessible name and the selection jumps to the next matching row,
  the way a screen reader's list navigation lets you skip ahead. Typing is
  buffered briefly so multi-character prefixes match, and it never steals the
  inline text-entry box open for a focused field. ([#213])
- Virtualize the tree panel's rendering so only the rows in view mount to the
  DOM. Large pages (thousands of nodes) now scroll and update smoothly instead
  of janking as the whole tree re-rendered on every change. ([#195])
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
[#195]: https://github.com/real-a11y/real-a11y-dev/pull/195
[#213]: https://github.com/real-a11y/real-a11y-dev/pull/213
[#244]: https://github.com/real-a11y/real-a11y-dev/pull/244
[#248]: https://github.com/real-a11y/real-a11y-dev/pull/248
[#287]: https://github.com/real-a11y/real-a11y-dev/pull/287
[#308]: https://github.com/real-a11y/real-a11y-dev/pull/308
[#315]: https://github.com/real-a11y/real-a11y-dev/pull/315
[#317]: https://github.com/real-a11y/real-a11y-dev/pull/317
