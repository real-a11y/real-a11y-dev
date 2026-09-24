---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
---

Stop the tree panel redoing per-row work on every keystroke.

Keyboard navigation looked the selected row up with a linear `indexOf` over the whole visible list on each keypress, and ArrowRight scanned that list once per child to find the first visible one — so arrow-key cost grew with the size of the expanded tree. Both now read an id→index map built once per visible list.

The `aria-controls` jump chips were also rebuilt inside the render loop: every rendered row re-resolved each link's target node and reformatted its label on every render, including renders that only moved the selection. They are now resolved once per tree, so an unchanged row is handed the same chip data across re-renders.

Rendering is unchanged — same rows, same chips, same navigation.
