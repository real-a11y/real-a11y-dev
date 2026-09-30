---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Let an element's own semantics decide its `checked`, `expanded` and `pressed` states, as Chromium does, instead of an ARIA attribute on it. The DOM producer copied the attribute, so an unchecked `<input type="checkbox" aria-checked="true">` reported `a11y.states.checked: true`, a `<select aria-expanded="true">` reported `expanded: true`, and an indeterminate checkbox reported no `mixed` at all:

```html
<input type="checkbox" aria-checked="true" aria-label="Terms" />
<select aria-expanded="true" aria-label="Size">
  …
</select>
<details>
  <summary aria-expanded="true">Shipping</summary>
  …
</details>
```

Each rule matches Chromium 151's own tree:

- **`<input type="checkbox">` and `<input type="radio">`:** `checked` is the control's checkedness, whatever its role and whatever its `aria-checked` says. An indeterminate checkbox (`.indeterminate = true`) is `"mixed"`, checked or not, even with `role="switch"`. A radio is never mixed. The state is always set: an unchecked one reports `checked: false`, where it reported nothing. Any other `<input>` type with a checkable role, such as `<input type="text" role="checkbox">`, still reads `aria-checked`.
- **`<select>`:** a drop-down ignores `aria-expanded`. Its `expanded` is whether its picker is open, so it reports `expanded: false`, where it reported nothing. A list box (`multiple`, or `role="listbox"`) has no `expanded` state. A `<select>` with another author role, such as `role="button"`, reads `aria-expanded` as before.
- **`<summary>`:** any `<summary>` child of a `<details>` takes `expanded` from whether the details is open, whatever its `aria-expanded` says. It reported nothing, or the attribute's value. It ignores `aria-pressed` too, unless a role such as `role="button"` makes it a toggle button. The `<details>` itself keeps its `expanded` state.

A live tree now also re-reads every checkbox and radio when it refreshes. A click on one radio unchecks its sibling, and a change handler can make a "select all" box indeterminate. Neither fires an event or changes an attribute on that other control, so its state went stale in a panel until something else re-extracted it.

What this changes for you:

- **Queries:** `findByRole` / `findAllByRole` with `{ checked: false }` now match an unchecked native checkbox or radio. They matched none, because the state was unset. The `checked` and `pressed` options now take `"mixed"`, too, so `{ checked: "mixed" }` finds an indeterminate checkbox. An indeterminate checkbox that is also checked no longer matches `{ checked: true }`, and a native checkbox no longer matches through its `aria-checked`. `{ expanded: false }` now matches a closed drop-down `<select>` and the summary of a closed `<details>`.
- **Tree diffs:** `a11yDiff` prints a checkbox or radio as `a11y.states.checked false → true` when it is checked, where it printed `(unset) → true`. Toggling a `<details>` now prints a change on its summary, as well as on the details.
- **Panels:** the state badges in `inspector`, `react` and `storybook-addon` show `checked=mixed` on an indeterminate checkbox. A native checkbox no longer shows `checked` for `aria-checked="true"`, and a summary no longer shows `pressed`. A radio its sibling unchecked, or a box a handler made indeterminate, now updates on the next refresh.
- **`toBeValidA11yTree`:** unaffected. It checks that required attributes are present, and a native checkbox or `<select>` never owed them.
- **Snapshots:** unaffected. An a11y snapshot prints roles and names, not states.
- **`cli` / `mcp`:** nothing they print changes. `real-a11y tabs` and `get_tab_order` print roles and names, and their other output reads Chromium's own tree.
