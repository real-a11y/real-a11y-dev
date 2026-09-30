---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Give a `<select>` the role of the widget it renders as. The DOM producer made every `<select>` a `combobox` unless it had `multiple`, but a select's role depends on how many rows it shows. Chromium reports a `listbox` when more than one row shows, and a `combobox` (a drop-down) when one row does:

| Markup                       | Was        | Now        |
| ---------------------------- | ---------- | ---------- |
| `<select size="3">`          | `combobox` | `listbox`  |
| `<select multiple size="1">` | `listbox`  | `combobox` |

The row count is the `size` attribute when it parses to a positive integer, as HTML parses one: `" 3"`, `"+3"`, `"3.5"` and `"2abc"` all count, while `"0"`, `"-1"` and `"abc"` do not. Without a usable `size`, a `multiple` select shows 4 rows and any other select shows 1. HTML-AAM maps every `multiple` select to `listbox`, but HTML allows a `multiple` select with one row to render as a drop-down, and Chromium does. Each case matches the role in Chromium 151's and 153's own accessibility trees.

- **Queries:** `findByRole("combobox")` / `findAllByRole` no longer find a `<select size="3">`. Query it as `listbox`. A `<select multiple size="1">` is now found as `combobox`. The select's actions are unchanged: `.select(value)` works on it under either role.
- **Snapshots and contracts:** a DOM-mode snapshot, tab sequence or `toMatchA11yContract` contract naming such a select changes from `combobox "Plan"` to `listbox "Plan"`, or the reverse for `multiple size="1"`. Re-record those baselines.
- **`toBeValidA11yTree`:** an authored role counts as redundant only when it matches the select's role, and `size` now decides that role. `role="listbox"` on `<select size="3">` is redundant. `role="combobox"` on that select, or on a `multiple` select with no `size`, is authored, so its options are reported as `option` nested inside `combobox`. The matcher used to count both as redundant, because `multiple` was never recorded on the node.
- **`dom.attributes`:** now records `size` and `multiple`. Panels in `inspector`, `react` and `storybook-addon` also re-read the tree when either one changes, so the role updates live.
- **`cli` / `mcp`:** only the tab sequence changes (`real-a11y tabs`, the `get_tab_order` tool), because it is the one view the in-page walk builds. A focusable `<select size="3">` now prints as `listbox` there, as the native `tree` already did.
