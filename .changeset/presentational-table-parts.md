---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

The DOM producer no longer exposes `rowgroup`, `row`, `columnheader`, `rowheader` or `cell` for the parts (`thead`, `tbody`, `tfoot`, `tr`, `th`, `td`) of a `<table role="presentation">` or `role="none"`. WAI-ARIA 1.2 removes those implicit roles with the table's; the parts are flattened and their text stays in the tree, as Chromium's tree already shows. `aria-label` or `tabindex` on the table, an authored role on a part, and focus or a global ARIA attribute on a part still keep the implicit role, and a nested data table stays intact. Saved DOM-produced snapshots of layout tables will churn: the table-part lines disappear. The CLI and MCP read Chromium's tree and their output is unchanged; they release because they bundle the same core.
