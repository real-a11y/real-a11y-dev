---
"@real-a11y-dev/core": patch
"@real-a11y-dev/semantic-navigator-ui": patch
---

Add `descendantText` preview for nodes whose accessible name is empty by spec. (Backfills the changeset for #38, which merged before the Changesets workflow was adopted in #41.)

`@real-a11y-dev/core` — new required `node.dom.descendantText: string` on every `SemanticNode`. Recursive `element.textContent` with whitespace collapsed and a 240-character cap. Captures text nested inside spans, presentational wrappers, and other non-text-bearing tags so consumers can show "what's in this element" when the accessible name is empty (`<code>`, `<pre>`, `<svg>` containing `<text>`, decorative wrappers).

`@real-a11y-dev/semantic-navigator-ui` — `TreeNode` falls back to a muted preview of `dom.descendantText` (italic, prefixed `≈`) in the a11y view when `a11y.name` is empty. Distinct from `.sn-name` so readers can tell it's a preview, not a real accessible name. New `.sn-name-preview` class in `tree.css`.
