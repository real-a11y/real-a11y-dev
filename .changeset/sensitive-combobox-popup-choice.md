---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

A sensitive field's popup no longer says which option is chosen. An ARIA combobox for a payment or credential field (`<input role="combobox" autocomplete="cc-exp-month">`) withholds its value as `[redacted]`, but the listbox it opens is not its descendant, so the option there kept `selected`, and since tree text prints a `{…}` states block by default, `option "03" {selected}` said what the field held. Now no option carries `selected` inside a sensitive field, or anywhere in what one controls (`aria-controls`) or owns (`aria-owns`), in either producer:

- **Chromium's tree** (`real-a11y tree`, `inspect`, `snapshot`, the MCP tree tools, the Playwright adapter's `tree: "native"`): Chromium leaves an owned listbox where it is under an `<input>`, so both relations are followed from the field.
- **The in-page tree** (`treeSnapshot`, the matchers, `real-a11y tabs`, `get_tab_order`, and the inspector, React and Storybook panels): the same rule, which also closes an older gap where an authored `aria-selected` on a sensitive `<select>`'s option still printed.

The relations count on the field or on an ARIA 1.1 combobox wrapped around it (`<div role="combobox" aria-controls="…"><input autocomplete="cc-number"></div>`), the field in its shadow root included, and a listbox such a wrapper holds as a child counts as its popup too. The live panels keep it withheld when a field gains its relation, becomes sensitive, or arrives after the first read. An ordinary combobox's popup keeps `{selected}`.

The chosen option no longer reaches a name either. A name built around the popup reads it in, as a field's value: `<label>Expiry month <input role="combobox" autocomplete="cc-exp-month" aria-controls="lb"> <ul role="listbox" id="lb">…</ul></label>` printed `combobox "Expiry month 03"` in both trees, and so did a name or description that names the listbox by `aria-labelledby` / `aria-describedby`, or a cell around it. Such a name now reads `"[redacted]"` and such a description is dropped, as for a sensitive field's own value. A popup with nothing chosen lends nothing, so its names are kept. Strict mode (`redactInput`) withholds the selection inside every choice field, as before, and now also in what a sensitive one controls or owns; an ordinary combobox's popup outside it still shows its selection there.
