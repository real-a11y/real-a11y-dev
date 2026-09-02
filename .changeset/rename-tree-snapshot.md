---
"@real-a11y-dev/testing": minor
---

Rename the tree-string helper to `treeSnapshot` and the boxed matcher helper to `boxedTreeSnapshot`.

`auditSnapshot` was a leftover name from before the tree / findings split — it serializes the semantic tree, not an audit. `a11ySnapshot` named the boxed `toMatchSnapshot()` wrapper after the product concept, colliding with that family. The three string views are now `treeSnapshot` / `outlineSnapshot` / `tabSequenceSnapshot`, matching the CLI (`tree` / `outline` / `tabs`). The Playwright handle method and `TreeSnapshotOptions` follow. The in-page bundle export is `treeSnapshot` too.

**Breaking change.** `auditSnapshot`, `a11ySnapshot`, and `AuditSnapshotOptions` are removed (beta). `a11ySnapshotSerializer` is unchanged — it also renders `a11yDiff` boxes.

**Migration.** `auditSnapshot(root)` → `treeSnapshot(root)`; `sn.auditSnapshot()` → `sn.treeSnapshot()`; `a11ySnapshot(root)` from `/matchers` → `boxedTreeSnapshot(root)`.
