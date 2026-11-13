---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

An element styled `visibility: collapse` is now hidden from the DOM-producer tree, as `visibility: hidden` already was. AccName 1.2 lists both as hidden, and Chromium drops them. Before, `<p style="visibility:collapse">x</p>` showed as `paragraph "x"` and a cell in a collapsed table row showed as a `cell`; they no longer appear, and their text no longer feeds a parent's name. Saved snapshots of pages that use `visibility: collapse` will churn.

`cli` and `mcp` bundle the same engine and read Chromium's own tree, which already hid these elements, so their tree output is unchanged; only the `tabs` walk, which runs in the page, shares the new check.
