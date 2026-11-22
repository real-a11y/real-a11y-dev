---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

A sensitive field's popup no longer says which item is chosen by a state other than `selected`. A page can mark the chosen item with `aria-checked` (a menu's `menuitemradio`, an option or tree item, a radio in a dialog popup), `aria-pressed` (a date picker's day button) or `aria-current`, and since tree text prints a `{…}` states block by default, `menuitemradio "03/31" {checked}` said what the field's `[redacted]` value holds. Now, wherever a sensitive field's choice is made (inside it, or in what it controls, owns or points `aria-activedescendant` into, or what a combobox around it holds), no node prints `selected`, `pressed` or `current`, and no option, tree item, menu item or radio prints `checked`, in either producer:

- **Chromium's tree** (`real-a11y tree`, `inspect`, `snapshot`, the MCP tree tools, the Playwright adapter's `tree: "native"`).
- **The in-page tree** (`treeSnapshot`, the matchers, `real-a11y tabs`, `get_tab_order`, and the inspector, React and Storybook panels), including the `aria-checked` its nodes record, and the live panels when such a choice is made, cleared or added.

A checkbox or switch in such a popup keeps its own `checked`: it is a control of its own. So does a toggle inside a field Chromium's tree reads as sensitive only because it holds one (a rich-text editor around a card input): there only an option's choice states, and any node's `selected`, are withheld, as before. A menu or radio group now counts as a popup a choice is made in, so a name that references the chosen item (`aria-labelledby`) reads `"[redacted]"`, and no node in such a popup keeps a description. Chromium's tree carries no `current`, and no `pressed` on an option, so the native producers read those marks from the document they already walk. Chromium's tree also withholds a name built around a popup whose choice is marked this way (a `<label>` around the field and its listbox), though Chromium reads only a `selected` choice into such a name; the in-page tree keeps it. An ordinary combobox's popup keeps all of these states. Strict mode (`redactInput`) withholds an option's choice states in every choice field.

`toBeValidA11yTree` counts `aria-checked` as supplied where the tree withholds it, as it does `aria-selected`, so a valid sensitive menu passes and a failure can't say which item is chosen.
