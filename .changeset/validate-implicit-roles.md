---
"@real-a11y-dev/testing": minor
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Stop reporting native HTML as broken ARIA.

`toBeValidA11yTree()` judged every node by the rules for an **authored** role.
`aria-query` genuinely marks `aria-checked` required on checkbox,
`aria-expanded` + `aria-controls` on combobox and `aria-selected` on option —
correct when someone wrote `role="combobox"`, because nothing else supplies
them. Applied to a `<select>`, it produced six violations on markup that is not
merely valid but preferable:

```
✖ option "A" — missing required aria-selected
✖ combobox — missing required aria-controls
✖ combobox — missing required aria-expanded
✖ option "A" — interactive "option" is nested inside "combobox"
```

The nesting line was the sharpest: `option` inside `combobox` is exactly how a
`<select>` is built, so the advice was to break correct markup.

`ValidatedNode` gains an optional `implicitRole`, set by the adapter when the
role came from the element rather than a `role=` attribute. When it is set,
required-ARIA-attribute checks are skipped — the user agent already exposes
that state — and `combobox`/`listbox` owning `option` is treated as structure.
The exemption is a named pair list rather than "any native nesting", so
`<button><a href>` is still reported.

Nothing is weakened for authored ARIA: `role="checkbox"` without `aria-checked`
is still an error, and a mixed pair (one authored side) is still reported.
Absent `implicitRole` means authored, so any consumer that authors roles by
construction keeps its current behaviour. `@real-a11y-dev/testing` is the only
package that uses the validator today.

Two related fixes fall out of the same finding, and these DO reach every
package that renders a tree — hence the patch bumps on `inspector`, `react`,
`storybook-addon`, `cli` and `mcp`, none of which use the validator but all of
which show accessible names:

- An **unchecked** native checkbox was flagged while a **checked** one passed,
  because states are recorded sparsely and "absent" was read as "missing".
- A `<table>` is now named by its `<caption>` per HTML-AAM. It previously read
  as unnamed — wrong to a screen-reader user, and reported as a violation since
  `table` is `accessibleNameRequired`. An explicit `aria-label` still wins, and
  the `caption` node is now dropped from the tree the way `legend`/`summary`
  already are, so the words appear once as the table's name rather than twice.
  **A committed snapshot containing a captioned table will change**: the
  `caption` line goes away and the `table` line gains the name.

Real problems are still caught: an unnamed `<select>`, a table with neither
caption nor label, and a link nested inside a button all still fail.
