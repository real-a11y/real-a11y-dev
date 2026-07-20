---
"@real-a11y-dev/testing": patch
---

Make the Playwright adapter work on CSP-protected pages and stop it silently auditing the wrong subtree. `attach()` injected the page bundle with `page.addScriptTag({ content })`, which appends an inline `<script>` — blocked outright by any page whose CSP `script-src` omits `'unsafe-inline'`, i.e. exactly the production-like deployments this adapter exists to audit, and the resulting error never mentioned CSP. The bundle is now injected by evaluating its source, which is not subject to page CSP, and the readiness error points at `bypassCSP` if injection still fails.

**Behaviour change:** a `rootSelector` that matches no element now throws (naming the selector) instead of falling back to `document.body`. Previously a typo'd or since-refactored selector silently audited the entire page, so assertions and snapshots passed while appearing to check one region — if a suite starts failing with `rootSelector "…" matched no element`, that test was auditing the whole document, not the region it named.
