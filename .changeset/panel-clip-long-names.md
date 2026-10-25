---
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": minor
---

A long name in the panel's tree now ends in an ellipsis instead of widening the tree, and a new **Show full names** setting brings the old layout back.

A row used to size itself, and so the whole tree, to its widest name: one long link or paragraph name (Spanish Wikipedia's run to a sentence) scrolled the panel sideways and put the end of every other row off screen. Now a row is as wide as the panel and a long name ends in "…", carrying its whole text as a tooltip. What follows the name on its row (badges, jump chips) shows when there is room beside the start of the name, and the role always shows. A row nested deeper than the panel is wide still scrolls the tree sideways, by just enough to show the start of its label, and no other row widens with it.

- The toolbar gains a Settings button (⚙) holding **Show full names**: rows widen to fit the longest name, and the tree scrolls sideways, as before. The choice holds for the life of the panel: through the inspector's `refresh()` and `setRoot()`, and across stories in Storybook.
- `@real-a11y-dev/inspector`: `SemanticNavigatorConfig` gains `showFullNames?: boolean` (default `false`), for a panel that starts with full names.
- `@real-a11y-dev/react`: `<SemanticNavigator>` gains the matching `showFullNames` prop. It only sets where the panel starts, so changing it remounts nothing.
- In the DOM view, attributes and text content carry their whole text as a tooltip too.
