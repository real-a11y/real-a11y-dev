---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Pick up the DOM producer's `aria-describedby` target fix. Both bundle the injected page bundle that carries the DOM extractor, which now keeps a visible description target in the tree. Their own output does not change: `tree`, `outline` and the other native-produced commands already included those nodes, and `tabs` lists tab stops, which a text-only target is not.
