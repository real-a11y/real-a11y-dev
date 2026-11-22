---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Stop widening a tree to the whole page for a menubar outside the root. Extraction widens to `document.body` when an overlay sits outside the root, so that a portaled menu or toast joins the tree, and it counted `role="menubar"` as one. But a menubar is a bar the page keeps showing, usually the site's top navigation: on a page with one, `treeSnapshot(form)` became a page snapshot and `tabSequenceSnapshot(form)` took in the bar's links, wherever the form was. A menubar now never counts as an overlay:

```html
<header>
  <nav>
    <ul role="menubar" aria-label="Site">
      <li role="none"><a role="menuitem" href="/">Home</a></li>
    </ul>
  </nav>
</header>
<main>
  <form aria-label="Zone">
    <input aria-label="Radius" /><button>Save</button>
  </form>
</main>
<!-- treeSnapshot(form) before: the whole page, menubar "Site" included
                        after:  form "Zone" with its textbox and button -->
```

A menu the bar opens (`role="menu"`) is still an overlay, wherever it mounts, so while one is open the tree still widens to take it in. Saved a11y snapshots of a component on a page with a menubar shrink to the component and need re-recording. The Storybook panel's change marks follow the same rule. `cli` and `mcp` change only in the tab order scoped to a root (`real-a11y tabs --root`, `get_tab_order` with `rootSelector`), the one output they build with the DOM producer.
