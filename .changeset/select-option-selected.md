---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

Report which option of a native `<select>` is selected. The DOM producer gave `<option>` no `selected` state, so panels drew no selected badge, `findByRole(tree, "option", { selected: true })` matched no native option and diffs couldn't show a selection moving. Each option of a drop-down or `<select multiple>` now carries `selected: true` or `selected: false` from its selectedness, as HTML-AAM maps it and as Chromium's own tree reports it; an authored `aria-selected` still wins, as in Chromium. A select whose value is withheld (for example `autocomplete="cc-exp-month"`) shows no `selected` on its options. Live trees refresh the state when a script sets `option.selected`. Saved DOM-producer snapshots that include a `<select>` will churn: each option gains a `selected` state.
