---
"@real-a11y-dev/testing": minor
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Stop reporting native HTML as broken ARIA — and let authored ARIA actually be
satisfied.

`toBeValidA11yTree()` judged every node by the rules for an authored role.
`aria-query` genuinely marks `aria-checked` required on checkbox,
`aria-expanded` + `aria-controls` on combobox and `aria-selected` on option —
correct when someone wrote `role="combobox"` on a `<div>`, because nothing else
supplies them. Applied to a `<select>` it produced six violations on markup
that is not merely valid but preferable, including `option` nested inside
`combobox`, which is exactly how a `<select>` is built.

The discriminator is **"does the user agent supply this state?"**, not "did
somebody type a `role=` attribute". Those diverge on ordinary markup:

- `<select role="combobox">` is redundant, changes nothing about the browser,
  and design systems produce it by spreading `role` through props.
- `<input type="checkbox" role="switch">` is the ARIA-APG canonical switch,
  where the role is neither redundant nor deletable — and checkedness is still
  UA-supplied.

`ValidatedNode` gains `uaSuppliedAttrs` (per-attribute, since an element can
supply one state and still owe another) governing required attributes, and
`implicitRole` governing structure. Both are optional and absent fails
**closed**, so an adapter that cannot inspect the element keeps reporting rather
than silently disabling the rule.

Three fixes make authored ARIA satisfiable at all — previously it could not go
green no matter what the author wrote:

- Required attributes are now read from the element's recorded attributes when
  the extracted state map doesn't carry them. `aria-controls` and
  `aria-valuenow` live in neither `A11yInfo.states` (a fixed 10-entry set) nor
  `properties` (`{level, captions}`), so a correct authored combobox or slider
  reported a violation with no remedy available.
- `aria-valuenow` / `aria-valuemin` / `aria-valuemax` are now recorded, for the
  same reason — nothing else carried them.
- A **`false`** value counts as present, not missing. `aria-expanded="false"` is
  a collapsed combobox and `aria-checked="false"` an unchecked box: the ordinary
  states, and previously unsatisfiable.

Real problems are still caught: an unnamed `<select>`, an unnamed `<table>`, a
link nested inside a button, an invalid role, and any hand-built role that omits
a state no user agent supplies.
