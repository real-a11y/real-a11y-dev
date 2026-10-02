---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Make an `<input>` whose `list` names a `<datalist>` a `combobox`. Typing in one offers the datalist's suggestions in a popup, and HTML-AAM and Chromium both make it a combobox. The DOM producer ignored `list`, so it reported a `textbox` (or a `searchbox` or `spinbutton`) where Chromium's own tree reports a `combobox`:

| Markup                                                | Was          | Now        |
| ----------------------------------------------------- | ------------ | ---------- |
| `<input list="fruits">` with `<datalist id="fruits">` | `textbox`    | `combobox` |
| `<input type="search" list="fruits">`                 | `searchbox`  | `combobox` |
| `<input type="number" list="fruits">`                 | `spinbutton` | `combobox` |

The text, search, email, tel and url types become a combobox, and so do number, date, datetime-local, month, week and time, as in Chromium. A password, range or color input keeps its role. The `list` has to name a `<datalist>` in the input's own document or shadow root. A missing id, another element, or a datalist across a shadow boundary leaves the role unchanged. An empty or hidden datalist still counts. Each case matches the role in Chromium 151's and 153's own accessibility trees.

- **Queries:** `findByRole("textbox")` / `findAllByRole` no longer find such an input. Query it as `combobox`. Its actions are unchanged: `.type(value)` still writes into it, and a number input still steps.
- **Snapshots and contracts:** a DOM-mode snapshot, tab sequence or `toMatchA11yContract` contract naming such an input changes from `textbox "Fruit"` to `combobox "Fruit"`. Re-record those baselines.
- **`toBeValidA11yTree`:** a combobox requires `aria-expanded` and `aria-controls`, but the browser runs a datalist's popup and tells the page nothing about it. So neither attribute is required on such an input, even under a redundant `role="combobox"`. An `<input role="combobox">` without a datalist is still reported for both.
- **Live trees:** panels in `inspector`, `react` and `storybook-addon` re-read an input's role when its `list` changes, or when the datalist it names is added or removed.
- **`cli` / `mcp`:** only the tab sequence changes (`real-a11y tabs`, the `get_tab_order` tool), because it is the one view the in-page walk builds. Such an input now prints as `combobox` there, as the native `tree` already did.
