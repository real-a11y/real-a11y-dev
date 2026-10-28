---
id: R44
suite: regression
scenario: "Extraction — the DOM producer names a paragraph with the words inside its inline wrappers, as Chromium does"
area: Testing
type: Automated
priority: P1
status: Active
validFrom: "testing ≥ the first release after 0.1.0-beta.20 (likewise inspector, react, storybook-addon). On 0.1.0-beta.20 or earlier every step reproduces the defect — the wrapped words are missing from the tree. That is the old behaviour, not a fail. The rule lives in `packages/core/src/extraction/dom-extractor.ts`, but `core` is PRIVATE and bundled, so assert against `@real-a11y-dev/testing` only."
validUntil: ""
expected: "a paragraph, list item, code block or status names itself with the text of its role-less inline wrappers (span, b, a custom or unknown element, role=none) and reads a br as a space; a wrapper with an id, title, aria- attribute or tabindex keeps its text to itself; a div's name is unchanged; the DOM and native trees agree"
covers:
  - packages.@real-a11y-dev/core
  - packages.@real-a11y-dev/testing
---

## Steps

In real Chromium (Playwright), open a page with this `<main>`, then take
`treeSnapshot()` through `attach(page)` from `@real-a11y-dev/testing/playwright`:

```html
<main>
  <p>Drop in <semanticnavigator> and the tree panel appears.</semanticnavigator></p>
  <p>A <span>span</span> <b>b</b> <x-foo>custom</x-foo> <span role="none">none</span> B</p>
  <p><span>only</span></p>
  <p>A<span>B</span>C</p>
  <p>Line one<br>Line two</p>
  <p>Kept <span id="x">id</span> <span title="t">title</span> <span aria-live="polite">live</span> out</p>
  <ul><li>Item <span>text</span></li></ul>
  <pre><code><span style="color: red">import</span><span> { a } </span><span>from</span><span> "b"</span><span>;</span></code></pre>
  <div>Loose <span>wrapped</span></div>
</main>
```

1. Read the paragraphs
2. Read the list item and the code block
3. Take the tree with `{ includeGeneric: true }` and read the `<div>`
4. Compare with the native tree: `serializeTree(await session.nativeTree())`
   from the same page, or `real-a11y tree` against it

## Expected

- **1** — `paragraph "Drop in and the tree panel appears."`,
  `paragraph "A span b custom none B"`, `paragraph "only"`, `paragraph "ABC"`
  (no space where the source has none), `paragraph "Line one Line two"`, and
  `paragraph "Kept out"`: a wrapper with an `id`, a `title` or an `aria-`
  attribute has a node of its own and keeps its text
- **2** — `listitem "Item text"` and `code "import { a } from "b";"`
- **3** — `generic "Loose"` with `generic "wrapped"` under it, as before: a
  generic does not read through its wrappers
- **4** — every line of steps 1 and 2 is in the native tree too (native adds
  `(level 1)` to the list item)

## Why this exists

The DOM producer named a paragraph from its own text nodes only. Chromium gives
a role-less inline element no node of its own, so its text is the paragraph's,
and the native tree kept every word. The DOM producer put the wrapped words on
a `generic` of their own, which no printed tree shows. So they vanished from
`treeSnapshot()`, the panels and every baseline built on them. The docs site's
home page shipped `paragraph "… no boilerplate. Drop in"` in its committed
baseline for a while: VitePress's `v-html` had turned a literal
`<SemanticNavigator />` into an unknown `<semanticnavigator>` element, and
nothing failed. Every syntax-highlighted code block on the site was a bare
`code` for the same reason.

The attribute list in step 1's last paragraph is the half that is easy to get
wrong in the other direction: reading through every `<span>` would put text
into the paragraph that Chromium keeps on a node of its own.

## Notes

A wrapper with an `id` keeps its text to itself in both producers, and since a
printed tree shows no `generic`, those words still don't show there. That is
the serializer folding generics, not this rule, and it is the same for both
producers.
