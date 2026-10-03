---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Report `expanded` only on a role Chromium gives the state. The DOM producer copied `aria-expanded` onto an element whatever its role, so each of these reported `a11y.states.expanded: true`, where Chromium's tree, which `cli` and `mcp` read, has no expanded state at all:

```html
<button role="radio" aria-checked="false" aria-expanded="true">Small</button>
<button role="heading" aria-expanded="true">Shipping</button>
<div role="listbox" tabindex="0" aria-label="Sizes" aria-expanded="true">…</div>
<input type="text" aria-label="Search" aria-expanded="true" />
```

The rule, as measured against Chromium 151 and 153, which agree on every case:

- **Roles with the state:** `application`, `button`, `checkbox`, `columnheader`, `combobox`, `gridcell`, `link`, `listitem`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `row`, `rowheader`, `switch`, `tab` and `treeitem` read `aria-expanded` as before.
- **Every other role ignores it**, including `listbox`, `option`, `radio`, `heading`, `textbox`, `searchbox`, `dialog`, `menu`, `tree`, `grid`, `cell` and `generic`. An element with no `role` goes by its own: a `<div>`, a `<span>`, an `<a>` without `href`, a text `<input>` or `<textarea>`, and a table's `<td>` have none. Neither does a `<td>` in a `role="grid"` table, which Chromium calls a gridcell; only an authored `role="gridcell"` has the state.
- **`<details>`:** it no longer has an expanded state of its own. The DOM producer set one from `open`, which Chromium never does: the summary carries the state. A `<details>` with one of the roles above, such as `role="button"`, reads `aria-expanded`, and `open` doesn't change it.
- **`<select>` under an author role:** reads `aria-expanded` only in one of the roles above, so `role="tab"` does and `role="menu"` doesn't.

What this changes for you:

- **Queries:** `findByRole` / `findAllByRole` with `{ expanded: true }` or `{ expanded: false }` no longer match an element whose role has no expanded state, such as a `listbox` with `aria-expanded`, or a `<details>`. Query what carries it: the `combobox` that opens the list box, or the details' `<summary>`.
- **Tree diffs:** `a11yDiff` no longer prints `a11y.states.expanded` changes on those elements. Toggling a `<details>` prints a change on its summary only.
- **Panels:** the `expanded` badge in `inspector`, `react` and `storybook-addon` no longer shows on those elements.
- **`toBeValidA11yTree`:** unaffected. Of the roles ARIA gives `aria-expanded`, only `combobox` requires it, and a combobox keeps the state.
- **Snapshots:** unaffected. An a11y snapshot prints roles and names, not states.
- **`cli` / `mcp`:** nothing they print changes. `real-a11y tabs` and `get_tab_order` print roles and names, and their other output reads Chromium's own tree.
