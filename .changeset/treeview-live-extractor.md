---
"@real-a11y-dev/semantic-navigator-ui": patch
"@real-a11y-dev/inspector": patch
---

Wire `TreeView` to `LiveTreeExtractor` so inspector / `<SemanticNavigator>` live updates re-extract only dirty subtrees. Previously `TreeView` ignored the `DomObserver` `TreeChange` payload and called `extractA11yTree` / `extractDomTree` on every flush — the residual of audit finding #50 after #182 landed the incremental path for the extension, `useSemanticTree`, and the Storybook preview. Each flush now snapshots the result Map so a diff checkpoint baseline cannot be mutated by a later incremental splice. Inspector is re-released because it bundles the UI package.
