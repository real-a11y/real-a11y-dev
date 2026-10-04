---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
---

Follow a `<dialog>` that opens or closes outside the root a live tree observes. A panel scoped to part of the page — `inspector`'s `root`, React's `<SemanticNavigator root>` and `useSemanticTree`, the Storybook addon's story root — re-roots its tree onto a dialog opened with `showModal()`, wherever on the page that dialog sits. But a dialog mounted once beside the root, which is the usual shape:

```html
<main id="app">…</main>
<dialog id="confirm">…</dialog>
```

opens and closes without mounting anything. `showModal()` and `close()` change only its `open` attribute, outside the root, and nothing the live tree watches reported that. So the tree stayed on the page while the modal was open, and on the dialog after it closed, until some unrelated change inside the root refreshed it.

The live tree now watches the `open` attribute of every `<dialog>` outside the root and refreshes in full when one changes, so it follows a modal dialog in and out within one debounce. While such a dialog is open as a modal, a change inside it — content swapped in, a field typed into — refreshes the tree too, as it already did for a dialog mounted into `<body>` after the panel started. One opened with `show()` is not watched inside: it never becomes the tree's root.

What this changes for you, on a page with such a dialog:

- **Panels:** `inspector`, `react` and `storybook-addon` show the dialog as the tree's root while it is open, and the page again once it closes.
- **`useActiveModal()`:** returns the dialog's node while it is open and `null` once it closes. It returned `null` while the dialog was open, and could keep returning it after it closed.
- **`waitForMutations()` and `flow()`:** a step whose action only opens or closes such a dialog now settles one debounce after it, instead of waiting out its `timeout` / `waitTimeout`.
- **Still not heard:** a dialog removed while it is open, from anywhere deeper than a child of `<body>`. The tree catches up on the next refresh anything else causes. A dialog inside a shadow tree, beside a root in the same shadow tree, is not watched either, since it never takes the scope.

The Chrome extension observes the whole document, so it already followed these dialogs. `cli` and `mcp` don't keep a live tree, so nothing they print changes.
