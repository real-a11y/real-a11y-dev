---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Keep a table's `caption` node in the DOM producer's tree when its text is also the table's name. HTML-AAM maps `<caption>` to a `caption` node of its own, and Chromium (so the native producer) keeps it; the DOM producer used to drop it, so `<table><caption>Sales</caption>…` printed `table "Sales"` with no `caption` child. It now prints `table "Sales"` followed by `caption "Sales"`, and a non-interactive child of the caption, such as a heading, stays in the tree. A caption under a `role="none"` or `role="presentation"` table is still not exposed, per WAI-ARIA 1.2. The table's own name is unchanged. Saved DOM-producer snapshots of captioned tables will churn by one `caption` line. `cli` and `mcp` read Chromium's tree, so their output does not change; they release only because they bundle the same engine.
