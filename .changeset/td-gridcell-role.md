---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Report a `<td>` in a `role="grid"` or `role="treegrid"` table as `gridcell`, not `cell`. HTML-AAM maps such a cell to `gridcell`, and so does Chromium; only a `<td>` of a plain table is a `cell`. The DOM producer used to say `cell` for every `<td>`, so a `gridcell` query or assertion missed these cells and saved snapshots recorded the wrong role. Saved DOM-producer snapshots of grids will churn. The cell still reports no expanded state unless the author wrote `role="gridcell"`. The native producer (CLI `tree`, `audit`, MCP) already reported `gridcell`; the CLI change is the `tabs` command's in-page walk.
