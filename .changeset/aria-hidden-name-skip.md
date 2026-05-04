---
"@real-a11y-dev/core": patch
---

Fix accessible name computation to skip hidden subtrees (aria-hidden, hidden, inert, display:none, visibility:hidden, content-visibility:hidden) per WAI-ARIA accname-1.2 §4.3.2 step 2A. Previously, descendant text from `aria-hidden` SVG `<text>` elements (and similar decorative-but-rendered subtrees) leaked into the parent's name-from-content output, producing snapshots that didn't match what AT actually announces. Affects `extractDomTree`, downstream `extract*` helpers, and anything that surfaces `node.a11y.name` (testing snapshots, inspector panel, extension side panel).
