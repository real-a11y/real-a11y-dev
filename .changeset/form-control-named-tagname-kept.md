---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Keep a `<form>` and its controls when one of the controls is named `tagName` or `getAttribute`. A form lets a control shadow the form's own members, so in

```html
<form><input name="tagName" aria-label="Field" /><button>Go</button></form>
<button>Sibling</button>
```

`form.tagName` is the input, and reading it as a string threw. The DOM walk's per-element boundary then skipped the form together with the field and the button, so the page looked like it held only `Sibling`. The walk now reads the tag and the attributes of the element it builds through the prototype, which a named control cannot shadow, so the form is folded as a generic node and its textbox and `button "Go"` are kept, as they are for any other control name.

What this changes for you:

- **Snapshots and tree diffs:** a tree from such a page gains the form's controls. A committed baseline from one changes, so re-record it.
- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` walk the page themselves, so on such a page they now list the form's fields and buttons as tab stops. Native trees are unaffected.
- **Audits:** controls inside such a form are now audited, so an unlabeled field there is reported.
- **jsdom:** jsdom doesn't shadow a form's members, so a suite running on jsdom is unaffected. These pages broke in a real browser.
