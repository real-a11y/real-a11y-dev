---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

Fix the DOM producer's heading level. `aria-level` on `h1`–`h6` now wins over the tag number (`<h2 aria-level="3">` is level 3, as WAI-ARIA 1.2 §8.4 allows), and `0` or a negative `aria-level` reads as level 1 (Core-AAM §3.6.3). A value that does not parse (`abc`, a blank string) or overflows 32 bits reads as level 1, and a level of 10 or more is ignored, all as in Chromium, so `(level NaN)` can no longer appear. Saved snapshots of pages that set `aria-level` on a heading may churn.
