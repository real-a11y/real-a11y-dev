---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Stop freezing the page on a `<form>` with a control named `parentElement`. A form lets a control shadow the form's own properties, so on

```html
<form>
  <input type="hidden" name="parentElement" />
  <a href="/help">Help</a>
</form>
```

`form.parentElement` is the hidden input, and the input's parent is the form again. Every walk up the tree that met such a form went round that pair forever, freezing the tab with nothing thrown. Each walk now reads the form's real parent:

- **Extraction:** a link or a `contenteditable` editor inside such a form froze `extractA11yTree` and everything built on it, because deciding whether a link sits in editable content walks up from it. A `<header>` or `<footer>` inside one froze it too, walking up for its landmark role, and there a control named `assignedSlot` did the same. That includes the DOM walk that `real-a11y tabs` and the MCP's `get_tab_order` run in the page.
- **Live panels:** a refresh after a change inside such a form froze the `inspector`, `react` and `storybook-addon` panels, walking up from the change for the name, the description and the field value it moved. Their mutation observer, and `testing`'s `waitForMutations`, froze on a text change inside a form with a control named `parentNode` — and on a text change anywhere on a page with an `<img>`, `<form>`, `<embed>` or `<object>` named `parentNode`, which the document lets shadow its own properties the same way.
- **Actions:** typing into a custom text box inside such a form, a `role="textbox"` that isn't `contenteditable`, froze the panels' Type action and `testing`'s `dispatch`, walking up to decide whether it sits in editable content.
- **Element picker:** with pick mode on, hovering inside such a form froze the page when the form itself was not in the tree.
- **Portal visibility:** in browsers without `checkVisibility()`, the check that a portal overlay is visible walked up the same way.

Two reads gave a wrong answer instead of freezing:

- **Editable form:** a `<form contenteditable>` holding such a control was not an editing host, so it was no Tab stop and not focusable.
- **Shadow DOM:** at the top of a shadow root, a control named `parentNode` hid the component's host from a `<header>` or `<footer>` in the form, so it became a `banner` or `contentinfo` although the component sits in `<main>`.

What this changes for you:

- **Pages that froze** now extract, refresh and pick. A page with no such form, and nothing named `parentNode`, is unaffected.
- **jsdom** doesn't shadow a form's or the document's properties, so a suite running on it never froze, and its output doesn't change. These pages froze in a real browser, which includes the Playwright adapter.
- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` now return on such a page. Every other view reads Chromium's own tree and never froze.
