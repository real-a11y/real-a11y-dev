---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Walk up past a `<form>` with a control named `nodeType`. A form lets a control shadow the form's own properties, so on

```html
<main>
  <form>
    <input type="hidden" name="nodeType" />
    <fieldset>
      <header>Order summary</header>
      <button>Pay</button>
    </fieldset>
  </form>
</main>
```

`form.nodeType` is the hidden input rather than `1`. The walks up the page read each parent clobber-safely, then checked that it was an element with a plain `nodeType` read, which took the form for no element at all: a walk from anywhere inside the form stopped below it. Nothing threw; the answers were wrong.

- **A tree rooted inside such a form**, such as a matcher on the `<fieldset>` above or a panel's refresh after a change inside it, read as if nothing were above its root. The `<header>` came out a `banner` landmark although `<main>` scopes it, `aria-disabled` on an ancestor of the form no longer disabled the controls in it, and in a `contenteditable` form a link counted as a tab stop.
- **Element picker:** hovering or clicking inside such a form highlighted and picked nothing, rather than the nearest node above it.

What this changes for you:

- **Trees and picks inside such a form** now take the form and what is above it into account. A page with no form control named `nodeType` is unaffected.
- **jsdom** doesn't shadow a form's properties, so a suite running on it never hit this, and its output doesn't change.
- **`cli` / `mcp`:** their trees are Chromium's own and don't change. Tab order is the one in-page walk they run, and it can: with `tabs --root`, or `get_tab_order`'s `rootSelector`, inside a `contenteditable` form holding such a control, a link in it is no longer listed as a tab stop.
