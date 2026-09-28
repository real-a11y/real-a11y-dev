---
id: R11
suite: regression
scenario: "Native producer health — the tree a native audit reports is complete, addressed, and focus-aware"
area: MCP
type: Automated
priority: P1
status: Active
validFrom: "browser ≥ 0.1.0-beta.12 · cli ≥ 0.1.0-beta.2 (locators + focusedId unreleased). The native producer itself: browser ≥ 0.1.0-beta.11. Steps 6 / 6b as written (field values shown, sensitive ones redacted, --redact-input): cli ≥ 0.1.0-beta.7 (unreleased)"
validUntil: ""
expected: "native tree returns a document tree reaching UA-shadow media controls the in-page walk misses; every native FINDING carries a CSS locator identical to the DOM producer's for the same element (a shadow-root element stops its path at the boundary rather than faking a selector); the tree sets focusedId so [focused] renders; a field shows what it holds the way a screen reader announces it, while a sensitive field (password, one-time code, payment) only ever reads [redacted]; --redact-input withholds every value and all rich-text editor content."
covers:
  - packages.@real-a11y-dev/browser
  - cli.commands.tree.flags.--redact-input
notion: "https://app.notion.com/p/3aa1c354b0b581379ac1caea2338fb81"
---

## Steps

Use a page with a `<video controls>` (UA-shadow media controls), an image with no
`alt`, an unlabeled `<button id="go">`, an image nested under
`<section id="panel">`, a pair of sibling images, an element inside an open shadow
root, a text field, and a rich-text editor — `<div id="composer" contenteditable
role="textbox" aria-label="Message">` holding a `<p>` with a link in it, an `<h3>`,
and a `contenteditable="false"` mention chip `<a aria-label="Mention Alice">` — and a
`<input type="password" aria-label="Password">`.

**There is no `--producer` flag.** #258 removed the axis — every browser-driving read
is native now — so these are plain invocations. An earlier version of this row spelled
`--producer native` on most steps, which today is a bare parser error.

1. `real-a11y tree <url>` — and compare against the shadow-DOM reality of the page
2. `real-a11y audit <url> --format json` — inspect every finding's `locator`
3. Locator **agreement across producers** — no longer reachable from the CLI, since
   there is only one producer to ask. Step 8 is where this is still checked
4. `real-a11y list image <url>` — locators present on every entry
5. Focus a control, then `real-a11y tree <url>`
6. Type a sentinel into the text field and a second one into the password field,
   then `real-a11y tree <url>` and `real-a11y tree <url> --redact-input`
   - **6b** — write a third sentinel into the editor's paragraph, link text and
     heading (and one into the link's `href`), then `real-a11y tree <url>`; then
     `real-a11y tree <url> --redact-input`, the same with `-f json`, and
     `real-a11y audit <url> -f json --redact-input`
7. `real-a11y audit <url> --root main`
8. `pnpm --filter @real-a11y-dev/browser test:e2e`

## Expected

- **1** — the tree reaches the video's play / scrubber / mute controls, which live in
  UA shadow DOM and the old in-page walk could not see. Roles read in Chromium's
  vocabulary, which differs from the ARIA spelling in places — expected, not a bug
- **2** — **every** finding carries a `locator`. None is `(none)`
- **2, cont.** — the locators are the queryable, DOM-shaped ones:
  `#go`, `body > main > img`, `#panel > div > img`, `…img:nth-of-type(1)` / `(2)`
- **shadow root** — the path stops at the boundary (`button:nth-of-type(2)`), never
  `#document-fragment > button`, which would look queryable and match nothing. No
  locator contains `#document`
- **3** — nothing to run. Kept as a step so the loss is visible rather than quietly
  dropped: cross-producer locator agreement was this row's original headline
  assertion, and step 8's parity harness is now its only home
- **5** — `[focused]` marks the focused node. The tree sets `focusedId`; without it
  a focus action reports a bare `a11y.states.focused` flip instead of a focus move
- **6** — the text field prints its sentinel as its **value**, never its name:
  `textbox "<label>" = "<sentinel>"`. The password field prints
  `textbox "Password" = "[redacted]"` — the password sentinel, and any `•` bullets
  (which would give away its length), appear **nowhere**. With `--redact-input`
  neither field prints a value (no ` = ` at all). Before cli 0.1.0-beta.7 the tree
  withheld every value, so both fields printed bare
- **6b** — by default the editor's content is page content: the paragraph, link
  and heading read their sentinel text, and `textbox "Message" = "…"` holds it. With
  `--redact-input` (all three commands) the editor sentinel appears **nowhere**,
  while the structure survives: `textbox "Message"` keeps its label; inside it a
  bare `paragraph`, `link "[redacted]"`, `heading "[redacted]" (level 3)`, and
  `link "Mention Alice"` (a markup name, kept). `audit` does **not** report the
  withheld link as `no-unlabeled-interactive` — it is named, just not shown. cli
  0.1.0-beta.6 printed the editor text as those nodes' names and had no strict
  mode
- **4** — locators on every entry. Native `list_elements` used to carry none, and
  three docs stated that as intended; both were fixed together
- **7** — refused: the read is whole-document, so it cannot be combined with a root
  selector. `tabs` is the only command that still accepts `--root`
- **8** — the parity harness passes its overlap **floor** (0.80) and logs the
  watermark — 88.7% at time of writing. It is a floor, not equality: the two
  producers are never byte-identical

## Why this exists

Replaces the old _"producer parity — get_native_tree + compare_producers"_ row, which
named a tool that never existed and one the native-only migration deleted.

This row has now been wrong about the producer surface **twice**, in the same
direction: it referred to `get_native_tree`, which was never real, and then to
`--producer native`, which stopped being real at #258 while the row went on
prescribing it. Both are flag- and tool-level rot inside prose, which the coverage
gate cannot see — it works at command and tool granularity. Worth knowing about the
limit of the mechanical checks: they prove a scenario names a real _capability_, not
that every invocation inside it still parses.

Both behaviours checked here are recent repairs, and both failed silently rather
than loudly:

- **Locators.** Native findings previously carried **none at all** — `audit` is
  documented as rule · severity · locator, and native delivered two of three. Real
  defects with no address.
- **`focusedId`.** The native tree knew where focus was (per-node `focused`) and had
  no way to say so, because every consumer reads the tree-level pointer.

Steps 6 and 6b guard the field-value policy (ADR-0001), which has a privacy
cost either way it fails. A field's value is what a screen reader announces, so
the tree shows it — but a password must read `[redacted]` and never Chromium's
masking bullets, whose count is the password's length. And what sits in a
rich-text editor is its value too: Chromium reports it as the host's AX `value`
*and* names the nodes inside the editor from it, so `--redact-input` has to close
both paths or the strict mode leaks through names. A test with a plain `<input>`
can never see the second path: it needs content-named nodes under an editable
host.

Parity itself is now a standing automated gate, so this row checks the things that
gate can't see.

## Notes

Replaces the old "producer parity — get_native_tree + compare_producers" row, which
named a tool that never existed (`get_native_tree`) and one the native-only migration
deleted (`compare_producers`). Parity itself is now covered automatically by
`packages/browser/e2e/native-parity.e2e.test.ts`, which asserts an overlap FLOOR
(0.80) and logs the watermark — 88.7% at time of writing. Locators and `focusedId`
are recent fixes: before them a native audit reported real defects with no address,
and `focus` diffed to a bare state flip.
