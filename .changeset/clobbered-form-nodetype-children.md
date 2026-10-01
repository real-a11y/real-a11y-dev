---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Keep a `<form>` in the tree when one of its controls is named `nodeType`. A form lets a control shadow the form's own members, so in

```html
<main>
  <form aria-label="Pay">
    <input type="hidden" name="nodeType" />
    <label>Card <input /></label>
    <button>Pay</button>
  </form>
</main>
```

`form.nodeType` is the hidden input, not `1`. The DOM walk keeps an element's children by testing that number, so it took the form for something other than an element and dropped it with everything inside it: `treeSnapshot()` printed a bare `main`, and `tabSequenceSnapshot()` printed `(nothing focusable)`. The tree now has `form "Pay"` with `textbox "Card"` and `button "Pay"` in it, and the tab sequence lists both controls.

Other walks dropped such a form the same way, and now read through it:

- **Names and text:** a heading, link, button or cell named from its content left out the text inside such a form, so `<h2>Checkout <form>…<span>now</span></form></h2>` was `heading "Checkout"` and is now `heading "Checkout now"`. So did a wrapping `<label>`'s text, the text preview of an element with no name, and the value of a contenteditable editor holding one.
- **Live panels:** in `inspector`, `react` and `storybook-addon`, adding or removing such a form left any element named or described through `aria-labelledby` or `aria-describedby` from inside it with its old name or description.
- **Portals:** a form mounted straight into `<body>`, outside the root being watched, was never checked for a dialog or menu, so opening one left the tree as it was. It now triggers a full re-extraction.

What this changes for you:

- **Pages without such a name** are unaffected.
- **Snapshots and tree diffs:** a tree from such a page gains the form and its contents. A committed baseline from one changes, so re-record it.
- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` run the DOM walk in the page, so on such a page they now list the form's controls. Native trees are unaffected.
- **jsdom:** jsdom doesn't shadow a form's members, so a suite running on jsdom is unaffected. These pages broke in a real browser, which includes the Playwright adapter.
