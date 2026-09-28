---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Report an option in a disabled `<select>` or `<optgroup>`, and a control inside an `aria-disabled` container, as disabled. The DOM producer read `disabled` from a form control's own state and from the node's own `aria-disabled`, so none of these had one:

```html
<select disabled>
  <option>Red</option>
</select>
<select>
  <option disabled>Green</option>
</select>
<div role="group" aria-label="Shipping" aria-disabled="true">
  <button>Quote</button>
</div>
```

Chromium reports `Red`, `Green` and `Quote` as disabled, and a screen reader announces them as unavailable. Their nodes now carry `a11y.states.disabled: true`. Each case matches the `disabled` property of Chromium 151's own tree:

- **Options** are disabled by their own `disabled`, by their `<optgroup disabled>`, or by their select, including a select disabled by its `<fieldset>`. The optgroup itself stays unmarked, as in Chromium.
- **Inside a disabled container**, an element inherits the state from the nearest ancestor that is a disabled `button`, `input`, `select` or `textarea`, or that sets `aria-disabled`. An `aria-disabled="false"` on the way stops it. It can't re-enable a disabled control or what that control holds.
- **Only focusable elements inherit the state**, as CORE-AAM says: a button, a link with an `href`, a field, a `tabindex` element, or a native option. A paragraph, a heading or a `<div role="button">` with no `tabindex` inside an `aria-disabled` group stays as it was.
- **A disabled `<fieldset>` passes the state to nothing but its form controls.** The fieldset itself, a `<div role="button" tabindex="0">` or an `<a href>` inside it, and a control in its first `<legend>` all stay enabled.
- The walk follows the flat tree, so a control in a shadow root, or slotted into one, inherits the state too. An ancestor above the extracted root counts too.

What this changes for you:

- **Queries:** `findByRole` / `findAllByRole` with `{ disabled: true }` now match these nodes.
- **Tree diffs:** toggling a container's `aria-disabled`, or a select's `disabled`, now changes the state of every focusable element or option inside it. `a11yDiff` prints `~ button "Quote": a11y.states.disabled (unset) → true` for each one, so a committed diff snapshot around such a toggle gains those lines. Re-record it. A spec using `flow().expectChanges` that already passed still passes, because it matches changes as a subset.
- **Panels:** the tree's `disabled` badge in `inspector`, `react` and `storybook-addon` now shows on these nodes.
- **Snapshots:** unchanged. An a11y snapshot prints roles and names, not states.
- **`cli` / `mcp`:** nothing they print changes. The page walk that ships inside them has the fix, but no output of theirs shows a DOM-produced state.

The page walk also no longer hangs on a `<form>` whose control is named `parentElement` or `assignedSlot`. Such a control shadows the form's own property, so a walk up the tree read the form's parent as that control and looped forever. A `<header>` or `<footer>` inside such a form hung the extraction before this change, and every focusable element in one now walks up the same way.
