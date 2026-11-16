---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

The native tree no longer reports a list item's nesting depth as a level. Chromium computes `level` for every `<li>`, so `tree`, `audit`, `inspect`, `snapshot`, the MCP tools and the testing package's native mode printed `listitem "Item 1" (level 1)` (and `(level 2)` on a nested item) although no author set `aria-level` and the DOM producer prints none. A `listitem` now carries no `level` property and prints with no `(level N)`, so it matches the DOM producer; `heading`, `treeitem` and `treegrid` `row` levels are unchanged. Saved native snapshots and baselines containing list items will churn: re-record them. An authored `aria-level` on a list item is also dropped, as it already was in the DOM producer.
