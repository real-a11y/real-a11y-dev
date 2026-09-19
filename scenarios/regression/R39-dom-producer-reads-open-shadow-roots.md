---
id: R39
suite: regression
scenario: "Extraction — the DOM producer reads open shadow roots and slots, so web components are not empty hosts"
area: Testing
type: Automated
priority: P0
status: Active
validFrom: "testing ≥ the first release after 0.1.0-beta.16 (likewise inspector, react, storybook-addon). On 0.1.0-beta.16 or earlier every step reproduces the defect — shadow content is missing and the assertions pass without seeing it. That is the old behaviour, not a fail. The walk lives in `packages/core/src/extraction/flat-tree.ts`, but `core` is PRIVATE and bundled, so assert against `@real-a11y-dev/testing` only."
validUntil: ""
expected: "shadow content appears under its host; slotted children appear at their slot, unslotted ones not at all; slot fallback renders when nothing is assigned; IDREFs resolve inside the shadow root, never against a same-id element in the document; a closed root stays opaque; an inspector panel mounted inside the inspected root never lists its own controls"
covers:
  - packages.@real-a11y-dev/core
  - packages.@real-a11y-dev/testing
  - packages.@real-a11y-dev/inspector
notion: "https://app.notion.com/p/3e01c354b0b581af92f6f80dcf54fc91"
---

## Steps

Define these custom elements with `attachShadow({ mode: "open" })`, then take
`treeSnapshot(document.body)` and run `assertNoUnlabeledInteractive(document.body)`:

1. `<skip-to>` whose shadow root holds `<button aria-label="Skip To Content">`
   (the SkipTo.js shape on the W3C APG pages)
2. `<x-card><a href="/docs">Read the docs</a><button slot="nope">Unrendered</button></x-card>`,
   whose shadow is `<h2>Card title</h2><slot></slot><button>Close</button>`
3. `<x-empty>` whose shadow is `<slot><button>Default action</button></slot>`,
   with no light children
4. `<span id="lbl">Wrong label</span><x-field>`, whose shadow is
   `<span id="lbl">Email address</span><input aria-labelledby="lbl">`
5. `<x-bad>` whose shadow holds a `<button>` with no text and no label
6. A host with `attachShadow({ mode: "closed" })` holding a button
7. `createInspector({ root: document.body, container })` with `container`
   appended to `body`, in both `mount: "shadow"` and `mount: "light"`, then
   `getTree()`

## Expected

- **1** — `button "Skip To Content"` is in the tree
- **2** — `heading "Card title"`, `link "Read the docs"`, `button "Close"`, in
  that order; **no** `Unrendered` anywhere, because no slot takes it and the
  browser never renders it
- **3** — `button "Default action"` (slot fallback)
- **4** — `textbox "Email address"`, never `Wrong label`
- **5** — `assertNoUnlabeledInteractive` **throws**. Before this change it
  passed, because it never saw the button
- **6** — no button: a closed root cannot be read from page script, and the
  host stays a leaf
- **7** — the tree has the page's content and none of the panel's toolbar,
  search box or tree, in both mount modes. The container carries
  `data-real-a11y-panel` while mounted and loses it on `unmount()`

## Why this exists

The DOM producer used to walk light-DOM `children` only. On the W3C APG pages
Chromium's native tree showed a Skip To Content button that the DOM tree didn't
have: SkipTo.js mounts it in an open shadow root. The same gap hid every web
component (Lit, Shoelace, design-system custom elements) from the panel, the
inspector, and the `testing` matchers and assertions. So a component with an
unlabeled button **passed** step 5's assertion. That's the worst failure mode
for an assertion library: silence that reads as clean.

Step 7 guards the obvious regression from fixing it. The inspector mounts its
own panel in an open shadow root, so a walk that follows shadow roots would list
the panel's controls as page content whenever the container sits inside the
inspected root.

## Notes

Live views (the panel and the extension) don't yet re-extract when something
changes inside a shadow root; their mutation observer doesn't reach into shadow
trees. That's a known gap, not part of this row.
