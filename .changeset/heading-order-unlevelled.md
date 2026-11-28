---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

`heading-order` no longer drops a `role="heading"` that has no valid `aria-level` on the DOM path. The rule compares it at level 2, the level Chromium exposes, so `<h1>`, an unlevelled heading, then `<h3>` is no longer reported as a skip from h1, and a skip right after it reads "the previous heading was h2". This changes the findings of `collectFindings`, `assertHeadingOrder`, `toHaveValidHeadingOrder` and `attach(page)` on the DOM tree. `cli` and `mcp` re-release the bundled engine; their native-tree output is unchanged by this release. The missing `aria-level` itself is still reported by `toBeValidA11yTree`.
