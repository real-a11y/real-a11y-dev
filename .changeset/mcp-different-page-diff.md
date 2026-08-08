---
"@real-a11y-dev/mcp": patch
---

fix(mcp): a checkpoint diff across two different pages no longer dumps a structural summary

Checkpoints deliberately survive navigation, which makes it easy to check one
route and diff another — and the advisory structural summary then reports the
whole page as rewritten. Hundreds of added and removed headings, landmarks and
tab stops, none of which is a regression.

`diff_findings` and `diff_checkpoints` now compare the two sides' addresses. When
they are different pages, both name the two URLs and drop that section; findings
still diff normally, since a `v1:` fingerprint keys on rule + role + locator, not
on position.

"Different page" means the path, query or fragment differs — **host, port and
scheme are ignored on purpose**. Diffing prod against a preview is the headline
workflow for these tools, and there the structural summary is the whole point.
An unparseable address is never treated as a mismatch: dropping a section on a
guess is worse than printing a noisy one.

A checkpoint also now records where the page **is**, not where `open_page` landed.
`click_element` can navigate, so those are different addresses — and recording
the stale one left a diff across two genuinely different pages looking like one
page twice. `A11ySession` gained `currentUrl()` (already on `BrowserSession`) so
a consumer holding the interface can read it at extraction time.
