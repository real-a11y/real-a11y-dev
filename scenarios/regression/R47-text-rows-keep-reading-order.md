---
id: R47
suite: regression
scenario: "Extraction — an element that mixes its own text with child nodes keeps its reading order as `text` rows, in both producers"
area: Testing
type: Automated
priority: P1
status: Active
validFrom: "the FIRST release after testing 0.1.0-beta.23 (likewise inspector, react, storybook-addon) and after cli / mcp 0.1.0-beta.13. On those versions or earlier every changed line of steps 1 and 2 reproduces the old behaviour — the element carries its own text as a name and lists the children after it. That is the old behaviour, not a fail. Both rules live in `core` (`packages/core/src/extraction/a11y-extractor.ts` and `packages/core/src/native/ax-normalize.ts`), which is PRIVATE and bundled, so assert against the published packages only."
validUntil: ""
expected: "a paragraph or list item that holds a link, a code, a strong or a nested list prints no name and one `text` row per run of its own text, between the children in source order; an element with only text or only role-less wrappers, one its author named, and a role named from its content are unchanged; the DOM and native trees agree"
covers:
  - packages.@real-a11y-dev/core
  - packages.@real-a11y-dev/testing
---

## Steps

In real Chromium (Playwright), open a page with this `<main>`, then take
`treeSnapshot()` through `attach(page)` from `@real-a11y-dev/testing/playwright`:

```html
<main>
  <p>You accept our <a href="/terms">terms</a> and have read our <a href="/privacy">privacy policy</a>.</p>
  <p>Run <code>pnpm verify</code> before you push.</p>
  <ul><li>Outer<ul><li>Inner</li></ul></li></ul>
  <p>Sent</p>
  <p>Pure <b>bold</b> text.</p>
  <p aria-label="Legal">See the <a href="/terms">terms</a>.</p>
  <h2>Read the <a href="/docs">docs</a> first</h2>
</main>
```

1. Read the first two paragraphs
2. Read the list
3. Read the last three paragraphs and the heading
4. Compare with the native tree: `treeSnapshot()` through
   `attach(page, { tree: "native" })` on the same page, or `real-a11y tree`
   against it

## Expected

- **1** — the first paragraph is a bare `paragraph` holding, in this order,
  `text "You accept our"`, `link "terms"`, `text "and have read our"`,
  `link "privacy policy"`, `text "."`. The second is a bare `paragraph` holding
  `text "Run"`, `code "pnpm verify"`, `text "before you push."`
- **2** — the outer item is a bare `listitem` holding `text "Outer"` and then
  the inner `list` with `listitem "Inner"`
- **3** — unchanged: `paragraph "Sent"`, `paragraph "Pure bold text."`,
  `paragraph "Legal"` with `link "terms"` under it and no `text` row, and
  `heading "Read the docs first" (level 2)` with `link "docs"` under it
- **4** — every line of steps 1 to 3 is in the native tree too, in the same
  order

## Why this exists

A prose element used to fold its own text into its name and list its children
after it, so the paragraph in step 1 printed
`paragraph "You accept our and have read our ."` above two links: no sentence,
and nothing to say where either link sits. `paragraph` is a role ARIA says
cannot be named, so that string was not an accessible name either, and
Chromium's own tree never had it: it keeps each run of text as an ordered
child. The DOM producer splits the name it already computed, and the native
normalizer keeps the runs it used to fold, so the two have to change together
or a DOM baseline and a native one stop reading alike.

Step 3 is the half that is easy to break in the other direction. The rows only
divide a name that is the element's own text: an author's `aria-label` is not
that text, a role-less `<b>` gets no node to sit beside, and a heading is named
from its whole content, links included.

## Notes

Each run is trimmed, so `our <a>` and `our<a>` print the same rows. A `text`
row is not an ARIA role, has no element of its own and takes no action.
