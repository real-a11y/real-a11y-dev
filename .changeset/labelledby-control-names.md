---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

The in-page tree now reads a form control that `aria-labelledby` or `aria-describedby` points at by its own name, as Chromium does. `<button aria-labelledby="c">Toggle</button>` over `<label for="c">Checkbox Label Text</label><input type="checkbox" id="c">` used to be named "Toggle", the button's own text; it is now "Checkbox Label Text", like Chromium's own tree. A referenced field gives its value, else its `aria-label`, its labels, its `title` and its placeholder, and a submit button input its value; any referenced element gives its `title` when nothing else names it. The same rule reaches a field inside a name: an empty field now lends its own name, so `<h2>Save <input placeholder="Draft"> now</h2>` is "Save Draft now", not "Save now". An empty single `<select>`, or an empty `textbox`, `searchbox` or `combobox` that isn't an `<input>` or `<textarea>`, still lends nothing, as in Chromium. This reaches every surface built on the in-page walk: the inspector panel, `@real-a11y-dev/react`, the Storybook addon, `@real-a11y-dev/testing`'s DOM tree and snapshots, the CLI's `tabs` and the MCP server's `get_tab_order`. Snapshots of such markup change. A value still never reaches a name unchecked: a sensitive field that holds anything makes the whole name `[redacted]`, and so does any entered value in strict mode (`redactInput`), including one in the label of a control a reference names. A live panel renames such a button when the control's label, `title` or placeholder changes.
