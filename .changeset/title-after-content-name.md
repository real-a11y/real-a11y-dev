---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

The DOM producer now names a link, button, heading, cell, summary or option from its content, and uses `title` only when nothing else names it. AccName 1.2 §4.3.2 step 2I puts the Tooltip step last ("only if nothing else, including subtree content, has provided results"), so `<a href="/" title="Tooltip">Home</a>` is `link "Home"` — as Chromium and screen readers report it — instead of `link "Tooltip"`. A `title` on an element with no content still names it, and still wins over `placeholder`. Names of titled elements change in the DOM-based surfaces (the inspector, `react`, the storybook addon, the `testing` matchers, `cli tabs`, `mcp` `get_tab_order`), so saved a11y snapshots of such elements will churn.
