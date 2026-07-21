---
"@real-a11y-dev/semantic-navigator-ui": patch
---

Announce the active row to screen readers in the tree panel. The `role="tree"` container holds focus (its rows are non-focusable `<div>`s), but it never set `aria-activedescendant` and the rows had no `id` — so arrowing through the tree only flipped `aria-selected` on rows the screen reader wasn't tracking, and a screen-reader user heard nothing. Each row now carries a stable `id` and the container points `aria-activedescendant` at the selected row. This flows to every `TreePanel` consumer — the inspector, the React `<SemanticNavigator>`, and the Storybook addon.
