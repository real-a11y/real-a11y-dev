---
"@real-a11y-dev/core": patch
---

Classify an editable combobox as a typeable text field. `getActions` treated every `role="combobox"` as click-only, so a custom **editable** combobox — a `contenteditable` `<div role="combobox">`, the ARIA 1.2 editable-combobox pattern used by rich search boxes — surfaced only a `click` action and couldn't be filled. Editable comboboxes (detected by `contenteditable`) now get `focus` + `type` like a textbox, so tooling and the extension panel treat them as text entry; **select-only** comboboxes keep `click` to open their popup natively. Native `<input role="combobox">` was already handled by the input branch and is unchanged.
