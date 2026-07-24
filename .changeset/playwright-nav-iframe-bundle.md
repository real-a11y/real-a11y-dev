---
"@real-a11y-dev/testing": patch
---

Harden the Playwright adapter across three sharp edges, all in `attach()`.

**The handle now survives navigation.** The audit bundle lives on `window`, so `page.goto()` (or an SPA hard navigation) wiped it and the next handle call died inside the page with a bare `Cannot read properties of undefined`. `attach()` now registers an init script that re-injects the bundle into every subsequent document, so a `Page` handle keeps working across a multi-page test. When the target is a `Frame` (no `addInitScript`), the page functions now throw a message that names the cause and the fix — "the page bundle is missing — this document navigated since attach(); call attach() again" — instead of the cryptic dereference.

**iframe non-traversal is documented and testable.** Extraction walks one document and never descends into an `<iframe>`, so auditing a page that embeds a checkout/payment frame passed clean while that content was never checked. The `attach` docs now state this, and `PlaywrightPage` accepts a `Frame` so you can `attach(page.frame({ name: … }))` to audit the frame's own document. e2e covers both the host-omits-frame behaviour and the frame audit.

**`test:e2e` builds first.** It read the prebuilt page-bundle from `dist/` but didn't depend on `build`, so a local run after editing source could green-light against a stale bundle — the exact staleness the adapter exists to prevent. A `pretest:e2e` step now rebuilds the package (and its bundle-owning deps) first.

Also drops the `sourceMappingURL` from the injected bundle, which resolved against the page under test and 404'd in DevTools.
