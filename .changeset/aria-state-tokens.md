---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Read every ARIA state value the way Chromium does. The DOM producer copied `aria-disabled`, `aria-checked` and the other states literally: `"true"` became `true`, `"false"` became `false`, and anything else stayed a string. So `aria-disabled="TRUE"` reported `a11y.states.disabled: "TRUE"`, and `aria-disabled=""` reported `""`, where Chromium reports disabled, and not set:

```html
<div role="group" aria-disabled="TRUE">…</div>
<button aria-pressed="MIXED">Bold</button>
<a href="/" aria-current="PAGE">Home</a>
<span aria-hidden="yes">★</span>
```

Each rule matches Chromium 151's own tree, value by value. None of them trims whitespace, so `" true"` is not `"true"`:

- **`disabled`, `hidden`, `busy`, `required`, `readonly`, `expanded`, `selected`:** `false` in any case is `false`. An empty value or `undefined` in any case leaves the state unset. Anything else is `true`, including `TRUE`, `yes`, `0`, `mixed` and `" false"`.
- **`checked`, `pressed`:** as above, except that `mixed` in any case is `"mixed"`, and only a lowercase `undefined` leaves the state unset (`UNDEFINED` is `true`). A `radio`, `switch` or `menuitemradio` has no mixed state, so its `aria-checked="mixed"` is `false`.
- **`current`:** `page`, `step`, `location`, `date` and `time` in any case come out lowercase. `false` in any case is `false`, an empty value or a lowercase `undefined` leaves it unset, and anything else is `true`.
- **`<optgroup>`** is never marked disabled, even with `aria-disabled="true"`, as in Chromium. Its options still inherit the state from it.
- **`aria-hidden`** hides for every value that reads as `true` above, not only for `"true"`. `<span aria-hidden="yes">` now leaves the tree, and its text leaves the accessible name of whatever contains it, as `aria-hidden="true"` always did.

What this changes for you:

- **Queries:** `findByRole` / `findAllByRole` with `{ checked: true }`, `{ disabled: true }` and the other state options now match `aria-checked="TRUE"`, `aria-disabled="yes"` and the like. A node inside `aria-hidden="TRUE"` is now left out, as one inside `aria-hidden="true"` already was.
- **Tree diffs:** `a11yDiff` prints these states as booleans, and `aria-current` in lowercase. A committed diff snapshot that shows one of them as a string, such as `a11y.states.disabled "TRUE"`, needs re-recording. Changing only the case of a value, such as `aria-expanded="true"` to `"TRUE"`, no longer prints a change.
- **Panels:** the tree's state badges in `inspector`, `react` and `storybook-addon` show `disabled` for `aria-disabled="TRUE"`, where they showed `disabled=TRUE`, and `current=page` for `aria-current="PAGE"`.
- **Snapshots:** an a11y snapshot prints roles and names, not states, so it changes only on a page that uses a value like `aria-hidden="TRUE"`, whose content now leaves the snapshot and the names that included it. A `<header>` or `<footer>` inside a `<section>` that is kept only for an `aria-busy=""` also drops out now, as it does from the native tree.
- **`cli` / `mcp`:** the tab order from `real-a11y tabs` and `get_tab_order` now leaves out a control inside `aria-hidden="TRUE"` or `aria-hidden="yes"`, as it already did inside `aria-hidden="true"`. Nothing else they print changes, because their other output reads Chromium's own tree.
