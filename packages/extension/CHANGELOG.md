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
