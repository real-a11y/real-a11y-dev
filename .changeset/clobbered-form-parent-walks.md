---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Stop freezing the page when something changes inside a `<form>` with a control named `parentElement`. A form lets a control shadow the form's own properties, so on

```html
<form>
  <input type="hidden" name="parentElement" />
  <p>Total: <span>$10</span></p>
</form>
```

`form.parentElement` is the hidden input, and the input's parent is the form again. Extracting such a page already works, but the walks that run after it went round that pair forever, freezing the tab with nothing thrown. Each now reads the form's real parent:

- **Live panels:** a refresh after a change inside such a form froze the `inspector`, `react` and `storybook-addon` panels, walking up from the change for the name, the description and the field value it moved.
- **Mutation observer:** the panels' observer, and `testing`'s `waitForMutations`, froze on a text change inside a form with a control named `parentNode` — and on a text change anywhere on a page with an `<img>`, `<form>`, `<embed>` or `<object>` named `parentNode`, which the document lets shadow its own properties the same way.
- **Element picker:** with pick mode on, hovering inside such a form froze the page when the form itself was not in the tree.
- **Portal visibility:** in browsers without `checkVisibility()`, the check that a portal overlay is visible walked up the same way.

What this changes for you:

- **Pages that froze** now refresh, observe and pick. A page with no such form, and nothing named `parentNode`, is unaffected.
- **jsdom** doesn't shadow a form's or the document's properties, so a suite running on it never froze, and its output doesn't change. These pages froze in a real browser.
- **`cli` / `mcp`:** nothing they print changes. The page walk that ships inside them has the fix, but none of their commands runs the walks above.
