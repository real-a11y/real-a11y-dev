---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Report a popover invoker's `expanded` state the way Chromium does: whether its popover is showing, whatever its `aria-expanded` says. The DOM producer copied the attribute, so a button whose popover was closed reported `a11y.states.expanded: true` if its `aria-expanded` said so, and one with no `aria-expanded` reported no state at all, open or closed:

```html
<button popovertarget="menu" aria-expanded="true">Menu</button>
<div id="menu" popover>…</div>
```

The rule, as measured against Chromium 151 and 153:

- **Which controls:** a `<button>`, or an `<input>` of type `button`, `submit`, `reset` or `image`, with a `popovertarget` that names a popover (any `popover` value), whatever its `popovertargetaction`. A `<button>` with a `commandfor` and a `command` of `toggle-popover`, `show-popover` or `hide-popover` (in any case) takes its state from the element `commandfor` names instead, which outranks `popovertarget`. That element decides even when it isn't a popover, which reports `expanded: false`.
- **Which don't:** a disabled control, including one in a disabled `<fieldset>`, and a submit button with a form, which submits it instead. A `<button>` with no `type` or an invalid one is a submit button, unless it has a `commandfor`. An id resolves only in the invoker's own tree, so a button outside a shadow root can't name a popover inside it. Each of these reads `aria-expanded` as before.
- **Inside its own popover:** a control inside the popover it invokes, like a close button, reads `aria-expanded` as before. A popover that invokes itself doesn't count as inside.
- **Roles:** only a role Chromium gives an expanded state takes the popover's: `button`, `link`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `tab`, `checkbox`, `switch`, `combobox`, `treeitem`, `row`, `gridcell`, `columnheader`, `rowheader`, `listitem` and `application`. An invoker with another author role, such as `role="radio"`, reads `aria-expanded` as before.

A live tree now also refreshes when a popover opens or closes. Neither changes an attribute, so nothing re-extracted, and a panel kept the invoker's old state and the popover's old content until something else changed. It now listens for the popover's `toggle` event, including for a popover outside the observed root, and re-reads every invoker on refresh. The event doesn't cross a shadow root, so a popover inside a component's shadow tree still updates only on the next refresh something else triggers. It also watches `popovertarget`, `commandfor`, `command`, `popover` and `form`.

What this changes for you:

- **Queries:** `findByRole` / `findAllByRole` with `{ expanded: false }` now match an invoker whose popover is closed, with or without `aria-expanded`, and `{ expanded: true }` one whose popover is showing. An invoker no longer matches through an `aria-expanded` that disagrees with its popover.
- **Tree diffs:** `a11yDiff` prints `a11y.states.expanded false → true` on an invoker when its popover opens. It printed nothing, since the attribute never changed.
- **Panels:** the `expanded` badge in `inspector`, `react` and `storybook-addon` follows the popover, and updates when it opens or closes.
- **`toBeValidA11yTree`:** a `role="combobox"` button that invokes a popover no longer fails with `missing required aria-expanded`. The browser supplies the state, as it does for a `<select>`.
- **Snapshots:** unaffected. An a11y snapshot prints roles and names, not states.
- **`cli` / `mcp`:** nothing they print changes. `real-a11y tabs` and `get_tab_order` print roles and names, and their other output reads Chromium's own tree.
