---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Keep a `<textarea>`'s markup text out of the tree. That text is the field's default value, not something the page renders — the browser shows what the field holds now — and for a sensitive field (`autocomplete="one-time-code"`, `cc-number`, `cc-csc`…) it is the secret itself. Every text the tree builds read it as page text anyway. On this page

```html
<input aria-labelledby="otp" />
<textarea id="otp" autocomplete="one-time-code">902114</textarea>
```

`treeSnapshot()` printed `textbox "902114"`, the one-time code as the name of the field it labels, with no option asking for values. It now prints `textbox`.

Where else the text reached, and no longer does:

- **Descriptions:** an element whose `aria-describedby` points at a textarea was described with its text.
- **Names from content:** a textarea given a role that takes its name from text (`<textarea role="generic">`) was named after it, and so was a heading or button around it: `heading "Pay 737"` is now `heading "Pay"`.
- **Panel labels:** the Tab Sequence view and the filtered lists in the `inspector`, `react` and `storybook-addon` panels label an unnamed node with its own text, so an unlabeled textarea was listed as its contents, the secret included. It is now listed by its tag: `<textarea>` in the Tab Sequence view, `(textarea)` in a list.
- **The `dom` facet:** the textarea's own `dom.textContent` and `dom.descendantText`, and the `dom.descendantText` of every element around it, carried the text, as did each panel's text previews.

What this changes for you:

- **A textarea's value is unaffected.** `a11y.value` still reads what the field holds now, `[redacted]` for a sensitive one, and `treeSnapshot({ values: true })` prints it as before.
- **An ordinary textarea's default text is gone from these places too.** It goes stale as soon as the user types, and Chromium's own accessibility tree never has it. A panel search for that text no longer finds the field; search for its label.
- **Snapshots and tree diffs:** a baseline that recorded a textarea's text in a name or description changes. Re-record it, and if the text it held was real rather than a fixture's, treat it as exposed.
- **`cli` / `mcp`:** only `real-a11y tabs` and `get_tab_order` walk the page themselves, so only they change. Every other command reads Chromium's tree, which never had the text.
