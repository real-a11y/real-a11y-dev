---
id: R41
suite: regression
scenario: "In-page panels — the tree follows a modal <dialog> mounted outside the panel's root, in and out, with nothing else changing"
area: React/Inspector
type: Manual
priority: P1
status: Active
validFrom: "inspector ≥ the first release after 0.1.0-beta.17 (likewise react, storybook-addon). On 0.1.0-beta.17 or earlier steps 2 and 4 reproduce the defect: the tree moves only when something inside `#app` changes. That is the old behaviour, not a fail. The observer lives in `packages/core/src/observation/dom-observer.ts`, but `core` is PRIVATE and bundled, so run it through a published panel."
validUntil: ""
expected: "opening the dialog with showModal() re-roots the panel's tree to the dialog, and closing it restores the page, each within about half a second and with no other change on the page; a change inside the open dialog appears in the tree"
covers:
  - packages.@real-a11y-dev/inspector
  - packages.@real-a11y-dev/react
notion: ""
---

## Steps

`examples/vanilla` mounts the inspector on `<main id="app">`, and its
`<dialog id="sample-dialog">` beside that, directly in `<body>`: the shape most
apps give their dialogs.

```bash
pnpm --filter "@real-a11y-dev/example-vanilla^..." build
pnpm --dir examples/vanilla exec vite
```

1. Load the page and note the panel's tree: its root row is `main`
2. Click **Open dialog**, then touch nothing else: no click in the page, no
   **Force refresh**
3. With the dialog still open, run this in the browser console:
   `document.querySelector("#sample-dialog .dialog-footer").append(Object.assign(document.createElement("button"), { textContent: "Extra" }))`
4. Click **Cancel**, and again touch nothing else
5. Repeat 2 and 4, closing with the dialog's **✕** button, then with Escape

## Expected

- **1** — the root row is `main`, holding the page's heading, controls and form
- **2** — within about half a second the root row becomes `dialog "Confirm action"`,
  holding its heading, its paragraph and its three buttons, and nothing from `main`
  is left. The panel goes inert behind the modal like the rest of the page, so read
  it rather than click it
- **3** — a button named `Extra` appears in the dialog's subtree
- **4/5** — within about half a second the root row is `main` again, with the whole
  page back

## Why this exists

Extraction has always pivoted onto an open modal wherever it sits, including beside
the root a panel was given. But nothing woke the live tree for one mounted there:
`showModal()` and `close()` mount nothing and change only the dialog's `open`
attribute, outside the observed root. So the panel stayed on `main` with the modal
open and on the dialog after it closed, until some unrelated change inside `#app`
refreshed it — while this very dialog told the reader to notice the panel updating.

The unit tests cover the observer, but jsdom has no `showModal()` and no top layer,
so they fake both. This row is the only check of the whole path in a real browser.
`react` and `storybook-addon` share the observer: a run of R20 or R21 with a dialog
mounted beside the root exercises the same thing.
