---
"@real-a11y-dev/core": minor
---

Track the focused element at extraction time. `ExtractionResult` gains an optional `focusedId` — the node id of the element that held focus when the tree was extracted, if that element is inside the extracted subtree.

Both `extractA11yTree` and `extractDomTree` now resolve `document.activeElement` (piercing shadow roots to the real target) and record it. Focus resting on `<body>`/`<html>` — the absence of focus — is treated as none, so a freshly-rendered page reports no `focusedId` and downstream snapshots don't change. A focused node that's flattened out of the a11y view (e.g. a decorative generic wrapper) is not inherited into that view.

This is the capture point for the `[focused]` marker rendered by the `@real-a11y-dev/serialize` / `@real-a11y-dev/testing` serializers.
