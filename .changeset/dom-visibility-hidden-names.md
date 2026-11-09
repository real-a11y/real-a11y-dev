---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

The DOM producer leaves text under `visibility: hidden` and `visibility: collapse` out of accessible names and descriptions, as AccName 1.2 §2A and Chromium do. A heading `visible <span style="visibility:hidden">hidden</span> more` was `heading "visible hidden more"` and is now `heading "visible more"`; the same goes for labels, wrapping labels, `aria-labelledby` and `aria-describedby` targets. A descendant that sets `visibility: visible` again still counts, and a hidden node that is itself the `aria-labelledby` or `aria-describedby` target keeps its whole subtree. This changes names and descriptions in DOM-produced trees (`inspector`, `react`, `storybook-addon`, `testing` with its default `tree: "dom"`) and in `cli` `tabs` and `mcp` `get_tab_order`, so saved snapshots of such nodes will churn. The native producer is unchanged.
