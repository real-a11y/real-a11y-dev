---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Read an editor's `a11y.value` the way Chromium does. The DOM producer left `aria-hidden` text and any popup out of every non-native field's value. Chromium does that only for a combobox you can't type into. It reads an editor's value, and any ARIA textbox's or searchbox's, as the text the field renders, which knows nothing of ARIA:

```html
<div contenteditable="true" role="textbox" aria-label="Message">
  Hello <span aria-hidden="true">[x]</span>world
</div>
```

The DOM producer read `"Hello world"`, and Chromium's own tree, which the native producer reads, says `"Hello [x]world"`. Both now say `"Hello [x]world"`.

The same rule covers a role-less or `plaintext-only` editor, an editable combobox or searchbox, a `role="textbox"` or `role="searchbox"` that isn't editable, and a popup inside any of them: `Apple` followed by a `role="listbox"` holding `Pear` reads `"Apple Pear"`. Each case matches the `value` in Chromium 151's tree over CDP. A combobox you can't type into still reads `"Apple"` in both cases, as before.

What stays out is unchanged: `display:none` and `hidden` text, `visibility:hidden` text, a closed `<details>`'s body, and the text of a nested `<select>`, `<textarea>` or `<datalist>`. So a sensitive control inside an editor still adds nothing to the editor's value, even inside `aria-hidden`, and it still reads `"[redacted]"` itself.

- **Snapshots and diffs with values on:** `treeSnapshot(root, { values: true })` and `a11yDiff(…, { values: true })` print the longer value for these fields. Re-record a committed snapshot that holds one. Snapshots without values don't change.
- **Panels:** a checkpoint diff in the `inspector`, `react` or `storybook-addon` panel now marks such a field as changed when `aria-hidden` text or a popup inside it comes or goes.
- **`cli` / `mcp`:** `real-a11y tabs` and `get_tab_order` read the tab order from this page walk, so an editor's tab stop now prints the value that `real-a11y tree` and `get_semantic_tree` already print for it: `textbox "Message" = "Hello [x]world"`. Under `--redact-input` / `REAL_A11Y_REDACT_INPUT=1` they still print no values. Nothing else they print changes, because their other output reads Chromium's own tree.
