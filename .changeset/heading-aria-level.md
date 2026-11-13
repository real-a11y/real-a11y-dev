---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

Fix the DOM producer's heading level. `aria-level` on `h1`–`h6` now wins over the tag number (`<h2 aria-level="3">` is level 3, as WAI-ARIA 1.2 §8.4 allows), and `0` or a negative `aria-level` reads as level 1 (Core-AAM §3.6.3). An unparseable `aria-level` no longer produces `(level NaN)`: `role="heading"` reads as level 1, like Chromium, and an `hN` keeps its tag number. Saved snapshots of pages that set `aria-level` on a heading may churn.
