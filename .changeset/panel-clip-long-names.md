---
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/react": minor
"@real-a11y-dev/storybook-addon": minor
---

A long name in the panel's tree now ends in an ellipsis instead of widening the tree, and a new **Show full names** setting brings the old layout back.

A row used to size itself, and so the whole tree, to its widest name: one long link or paragraph name (Spanish Wikipedia's run to a sentence) scrolled the panel sideways and put the end of every other row off screen. Now a row is as wide as the panel and a long name ends in "…", carrying its whole text as a tooltip. A row's role and name come first, and its key states, those that change what the element is or does (disabled, pressed, selected, required, …), are never cut off: they end the row's label, and the name ends in an ellipsis to make room for them. Text after the name ends in an ellipsis the same way, and the other badges and jump chips show whole once there is room for them. The DOM view's attributes and text content shorten the same way. A row too narrow for the start of its label and its key states, such as one nested deeper than the panel is wide, still scrolls the tree sideways, by just enough, and no other row widens with it.

- The toolbar gains a Settings button (⚙) holding **Show full names**: rows widen to fit the longest name, and the tree scrolls sideways, as before. It closes on Escape, on a press outside it, or when focus moves out of it. In a panel too narrow for one row, the toolbar now wraps onto a second, rather than cutting a control off at its edge. The user's choice holds for the life of the page, in every panel on it: through the inspector's `refresh()` and `setRoot()`, and every later inspector (as React makes whenever one of its props changes, or it remounts), and across stories in Storybook.
- `@real-a11y-dev/inspector`: `SemanticNavigatorConfig` gains `defaultShowFullNames?: boolean` (default `false`), for a panel that starts with full names.
- `@real-a11y-dev/react`: `<SemanticNavigator>` gains the matching `defaultShowFullNames` prop. It only sets where the panel starts, so changing it remounts nothing.
