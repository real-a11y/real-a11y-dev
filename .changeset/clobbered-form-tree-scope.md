---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Keep a `<form>` in the tree when one of its controls is named `getRootNode`. A form lets a control shadow the form's own members, methods included, so in

```html
<h2 id="pay-title">Payment</h2>
<form aria-labelledby="pay-title">
  <input type="hidden" name="getRootNode" />
  <button>Pay</button>
</form>
```

`form.getRootNode` is the hidden input, and calling it throws. The DOM walk calls it to find the tree an ID reference resolves in, so the throw dropped the form from the tree along with everything inside it:

- **Named by `aria-labelledby`:** the form above and its `Pay` button were missing. They now extract as `form "Payment"` and `button "Pay"`.
- **A description target:** a form that another field's `aria-describedby` points at was dropped the same way, even when it held a control. It is now kept, like any other target that holds a control.

A finding's locator walks up from the element it names, too. It read a control named `parentElement` as the form's parent, and ran round the form and that control until its depth cap, giving a selector like `form > input > form > input > form > button` that matches nothing. It now follows the form's real ancestors: `#app > section > form > button`. A control named `children` also cost the path its `nth-of-type`, which it now keeps.

What this changes for you:

- **Snapshots and tree diffs:** a tree from such a page gains the form and its contents. A committed baseline from one changes, so re-record it.
- **Findings:** a locator inside such a form now matches the element.
- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` run the DOM walk in the page, so on such a page they now list the form's controls.
- **jsdom:** jsdom doesn't shadow a form's members, so a suite running on jsdom is unaffected. These pages broke in a real browser, which includes the Playwright adapter.
