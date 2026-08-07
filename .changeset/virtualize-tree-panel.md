---
"@real-a11y-dev/inspector": minor
"@real-a11y-dev/storybook-addon": minor
---

Virtualize the `TreePanel` and extension side-panel tree lists so only rows in the viewport plus overscan are rendered, dramatically improving scroll, search, and expand-all performance on large trees. The `useVirtualTree` hook behind it is workspace-internal — it is exported from the private UI package, so it reaches you only as the behaviour of the panels above, not as an API you can import.
