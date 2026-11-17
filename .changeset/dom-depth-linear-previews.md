---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Extract a deeply nested page faster with the DOM producer. Each element's `descendantText` preview walked down to the bottom of its own subtree, so a chain of nested elements cost roughly the square of its depth (429 ms at 1,000 levels on one measured machine). A preview is now built from its children's, once per extraction, and the cost grows with the depth. Output is unchanged: the same roles, names, states and previews, so saved snapshots do not churn. `tabs` in the CLI and the injected page bundle that `mcp` uses carry the same change.
