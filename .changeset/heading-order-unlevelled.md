---
"@real-a11y-dev/testing": patch
---

`heading-order` no longer drops a `role="heading"` that has no valid `aria-level` on the DOM path. The rule compares it at level 2, the level Chromium exposes, so `<h1>`, an unlevelled heading, then `<h3>` is no longer reported as a skip from h1, and a skip right after it reads "the previous heading was h2". This changes the findings of `collectFindings`, `assertHeadingOrder`, `toHaveValidHeadingOrder` and `attach(page)` on the DOM tree; native-tree findings are unchanged. The missing `aria-level` itself is still reported by `toBeValidA11yTree`.
