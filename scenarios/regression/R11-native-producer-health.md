---
id: R11
suite: regression
scenario: "Native producer health — the tree a native audit reports is complete, addressed, and focus-aware"
area: MCP
type: Automated
priority: P1
status: Active
validFrom: "browser ≥ 0.1.0-beta.12 · cli ≥ 0.1.0-beta.2 (locators + focusedId unreleased). The native producer itself: browser ≥ 0.1.0-beta.11"
validUntil: ""
expected: "native tree returns a document tree reaching UA-shadow media controls the in-page walk misses; every native FINDING carries a CSS locator identical to the DOM producer's for the same element (a shadow-root element stops its path at the boundary rather than faking a selector); the tree sets focusedId so [focused] renders; a value typed into a field NEVER appears anywhere in the tree (R1)."
covers:
  - packages.@real-a11y-dev/browser
notion: "https://app.notion.com/p/3aa1c354b0b581379ac1caea2338fb81"
---

## Steps

Use a page with a `<video controls>` (UA-shadow media controls), an image with no
`alt`, an unlabeled `<button id="go">`, an image nested under
`<section id="panel">`, a pair of sibling images, an element inside an open shadow
root, and a text field.

1. `real-a11y tree <url> --producer native` vs `real-a11y tree <url>`
2. `real-a11y audit <url> --producer native --format json` — inspect every
   finding's `locator`
3. `real-a11y audit <url> --format json` (DOM) — compare the two locator sets
4. `real-a11y list image <url> --producer native` _(rejected today; see Notes)_
5. Focus a control, then `real-a11y tree <url> --producer native`
6. Type a sentinel into the field, then re-read the native tree
7. `real-a11y audit <url> --producer native --root main`
8. `pnpm --filter @real-a11y-dev/browser test:e2e`

## Expected

- **1** — native surfaces the video's play / scrubber / mute controls the in-page
  walk cannot reach; roles differ in places (Chromium vocabulary) and that is
  expected, not a bug
- **2** — **every** finding carries a `locator`. None is `(none)`
- **3** — for the same element, the two producers emit the **identical** locator:
  `#go`, `body > main > img`, `#panel > div > img`, `…img:nth-of-type(1)` / `(2)`
- **shadow root** — the path stops at the boundary (`button:nth-of-type(2)`), never
  `#document-fragment > button`, which would look queryable and match nothing. No
  locator contains `#document`
- **5** — `[focused]` marks the focused node. The tree sets `focusedId`; without it
  a focus action reports a bare `a11y.states.focused` flip instead of a focus move
- **6** — the sentinel appears **nowhere** in the tree. The producer never reads
  `.value`, drops the AX `value` field, excludes `valuenow`/`valuetext`, and copies
  only an allowlist of attributes
- **7** — refused: native is whole-document, so it cannot be combined with a root
  selector
- **8** — the parity harness passes its overlap **floor** (0.80) and logs the
  watermark — 88.7% at time of writing. It is a floor, not equality: the two
  producers are never byte-identical

## Why this exists

Replaces the old _"producer parity — get_native_tree + compare_producers"_ row,
which named a tool that never existed (native is reached via `producer: "native"`,
not a `get_native_tree` tool) and one the native-only migration deletes.

Both behaviours checked here are recent repairs, and both failed silently rather
than loudly:

- **Locators.** Native findings previously carried **none at all** — `audit` is
  documented as rule · severity · locator, and native delivered two of three. Real
  defects with no address.
- **`focusedId`.** The native tree knew where focus was (per-node `focused`) and had
  no way to say so, because every consumer reads the tree-level pointer.

Parity itself is now a standing automated gate, so this row checks the things that
gate can't see.

## Notes

Replaces the old "producer parity — get_native_tree + compare_producers" row, which
named a tool that does not exist (there is no `get_native_tree`; native is reached
via `producer: "native"`) and one the native-only migration deletes
(`compare_producers`). Parity itself is now covered automatically by
`packages/browser/e2e/native-parity.e2e.test.ts`, which asserts an overlap FLOOR
(0.80) and logs the watermark — 88.7% at time of writing. Locators and `focusedId`
are recent fixes: before them a native audit reported real defects with no address,
and `focus` diffed to a bare state flip.
