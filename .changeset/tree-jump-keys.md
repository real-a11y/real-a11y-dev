---
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/storybook-addon": minor
---

The tree panel's `aria-controls` jump chips get a keyboard path. `Alt`+`J` follows the selected row's first link to the row it controls (`tab` → `tabpanel`), and pressed again moves on to its next link, so every chip is reachable. `Alt`+`Shift`+`J` goes back to the row the jump came from, or to the first row that controls this one. The chips sit outside the Tab order, so until now a keyboard user could not follow them at all. The key is matched on the physical `J` key or the character, so it works with macOS Option, which types a symbol, and on Dvorak or Colemak. The tree keeps its name, "Semantic tree", and lists the keys in `aria-keyshortcuts`; a jump to a row the search hides clears the search.

A jump, by key or by clicking a chip, is now a selection like any other: it calls `onSelect` and `onNodeSelect`, so with `scrollHostOnSelect` the host page scrolls to the target, as it does for a click on its row.
