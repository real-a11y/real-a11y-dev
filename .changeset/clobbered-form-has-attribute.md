---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Keep a `<form>` in the tree when one of its controls is named `hasAttribute`. A form lets a control shadow the form's own members, methods included, so in

```html
<form aria-label="Signup">
  <input name="hasAttribute" aria-label="Nickname" />
  <button>Join</button>
</form>
```

`form.hasAttribute` is the input, and calling it throws. The DOM walk asks every element whether it carries a few attributes (the inspector panel's marker, `inert`, `onclick`, `tabindex`), so the throw dropped the form from the tree along with everything inside it. It now extracts as `form "Signup"` holding `textbox "Nickname"` and `button "Join"`.

The other questions asked of any element, whatever its tag, now survive such a form too:

- **Overlays outside the root:** a menu or dialog inside a form whose control is named `hasAttribute`, or a `<form role="dialog">` whose control is named `contains`, never widened the tree to take it in, so a component's or story's tree left it out while it was open.
- **Live panels:** in `inspector`, `react` and `storybook-addon`, a change in or around a form whose control is named `contains` or `matches` fell back to a full extraction, with a console warning outside production. It now updates in place. A plain form with a control named `matches`, mounted straight into `<body>`, no longer triggers a full re-extraction, since it can now be asked whether it is an overlay.
- **A form as the root:** watching a `<form>` whose control is named `contains`, through `react`'s `useSemanticTree` or `testing`'s `waitForMutations`, threw as the observer started.

What this changes for you:

- **Pages without such names** are unaffected.
- **Snapshots and tree diffs:** a tree from such a page gains the form and its contents. A committed baseline from one changes, so re-record it.
- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` run the DOM walk in the page, so on such a page they now list the form's controls.
- **jsdom:** jsdom doesn't shadow a form's members, so a suite running on jsdom is unaffected. These pages broke in a real browser, which includes the Playwright adapter.
