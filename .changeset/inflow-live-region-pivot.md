---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Stop widening a tree to the whole page for a live region the page renders in place beside the root. Extraction widens to `document.body` when an overlay sits outside the root, so that a portaled toast or menu joins the tree, but it took any visible live region with text for one: a `<p role="status">Loading…</p>` in the same `<main>` as the form under test turned `treeSnapshot(form)` into a page snapshot and put the page's links into `tabSequenceSnapshot(form)`. A live region (`status`, `alert`, `log`, or `aria-live="polite"`/`"assertive"`) now widens only when it sits in a different child of `<body>` from the root, which is where portals mount:

```html
<main>
  <h1>Page</h1>
  <p role="status">Loading…</p>
  <form aria-label="Zone">
    <input aria-label="Radius" /><button>Save</button>
  </form>
</main>
<!-- treeSnapshot(form) before: main, heading "Page", status "Loading…", form "Zone"…
                        after:  form "Zone" with its textbox and button -->
```

A toast portaled to `<body>` still widens, and so does a menu, listbox or dialog the page renders in place: only live regions are exempt. A live region in another child of `<body>` from the root (a status in `<header>` with the root in `<main>`, or both directly under `<body>`) still widens, because nothing in that markup tells it from a portal. The trade: a toaster that renders in place inside the app's container rather than portaling to `<body>` (react-hot-toast's and Sonner's `<Toaster />` do), or a toast portaled into a host element inside that container, no longer brings its toasts into a tree rooted at a component beside it; pass a root that contains the toaster or the host to see them. Saved a11y snapshots of a component that sat beside such a live region shrink to the component and need re-recording. The Storybook panel's change marks follow the same rule. `cli` and `mcp` change only in the tab order scoped to a root (`real-a11y tabs --root`, `get_tab_order` with `rootSelector`), the one output they build with the DOM producer.
