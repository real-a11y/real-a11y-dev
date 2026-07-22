---
"@real-a11y-dev/semantic-navigator-ui": minor
---

Virtualize the `TreePanel` and extension side-panel tree lists so only rows in the viewport plus overscan are rendered, dramatically improving scroll, search, and expand-all performance on large trees. Exposes the new `useVirtualTree` hook for custom tree views.
