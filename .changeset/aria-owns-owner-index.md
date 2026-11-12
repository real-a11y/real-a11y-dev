---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Make DOM extraction linear on pages that use `aria-owns` at scale. An orphaned `listitem`, `option` or `treeitem` looks for an `aria-owns` owner that supplies its required context (WAI-ARIA 1.2 §5.2.7), and each lookup rescanned every `[aria-owns]` element in the id scope, several times per element, so extraction time grew with the square of the page. Each extraction now builds one id → owner index per id scope and every lookup reads it. Roles, names and the tree are unchanged, so saved snapshots do not churn. The first owner in document order still decides, and an owner in one shadow root still gives no context to an element in another. Affects the DOM producer only: the inspector, React and Storybook panels, `testing`, and the `cli` `tabs` and `mcp` tab-order paths.
