---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

The DOM producer names an `input`, `select` or `textarea` from every label associated with it, joined with spaces in document order, as HTML-AAM and Chromium do. It read one label only, so a control with two labels was `textbox "First"` where Chromium gives `textbox "First Second"`. This changes names in DOM-produced trees (`inspector`, `react`, `storybook-addon`, `testing` with its default `tree: "dom"`) and in `cli` `tabs` and `mcp` `get_tab_order`, so saved snapshots of such controls will churn. The native producer is unchanged.
