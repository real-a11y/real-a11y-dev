---
"@real-a11y-dev/testing": minor
"@real-a11y-dev/cli": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
---

A snapshot of the tab sequence or the heading outline can reach the snapshot report.

- **`@real-a11y-dev/testing`:** `boxedTabSequenceSnapshot(root, options?)` and `boxedOutlineSnapshot(root, options?)`, from `@real-a11y-dev/testing/matchers`, box what `tabSequenceSnapshot` and `outlineSnapshot` print, as `boxedTreeSnapshot` boxes `treeSnapshot`. The text is the same, byte for byte; a committed snapshot changes once on the switch, losing the quotes a string snapshots inside. The snapshot report records the tree each was printed from and opens it on what the text shows: the TAB view for a tab sequence, the headings filter for an outline, badged `tabs` and `outline` in the list. A `tabSequenceSnapshot` or `outlineSnapshot` string still reaches no report, and still returns a string.
- **`@real-a11y-dev/cli`:** `show-report` opens those records the same way.
- **`@real-a11y-dev/inspector`, `@real-a11y-dev/storybook-addon`:** they re-release the bundled panel, which can now start on a role filter. Neither one asks it to, so nothing changes in their panels.

A record says which view it opens on in a new optional `view` field. A report from an earlier release opens such a record on the tree, as before.
