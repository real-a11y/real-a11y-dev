---
"@real-a11y-dev/testing": minor
---

refactor(browser)!: drop `listByRole` from the injected page bundle

**Potentially breaking for a caller that evaluates the IIFE directly.**
`window.__realA11y__.listByRole(root, filter)` no longer exists. Everything
routed through `BrowserSession` or `@real-a11y-dev/testing/playwright` is
unaffected — neither ever called it. If you do call it in-page, import it from
`@real-a11y-dev/testing` and run it in Node over an `ExtractionResult`, which
is what both of our own surfaces now do.

It had no in-page caller at all. Since the producer migration, `real-a11y list`
and the MCP's `list_elements` both run the category listing in Node over
Chromium's own tree; the only bundle exports the CLI and MCP still dispatch on
are `checkpointTree` and `diffSinceCheckpoint`. So the listing — and, after the
last release, its explanatory empty-category text — was injected into every
audited page for nobody.

Removing it takes the bundle from **9.96 kB → 9.59 kB** gzipped, which puts it
back under the **10 KB** budget. The limit had been raised to 11 KB one release
earlier purely to fit that text; this reverts it, so the budget is a real
constraint again rather than a number that moves whenever it binds.

Scope was decided by measurement, not instinct. Six other exports have no caller
in this repo either (`findByRole`, `findAllByRole`, `getOutline`,
`getTabSequence`, `linearize`, `A11yAssertionError`) — dropping all of them saved
a further **0.07 kB**, because what stays pulls them in anyway. Seven breaking
removals for 0.07 kB is a bad trade, so they stay.

Also adds `src/page-bundle.test.ts`, which pins the bundle's exports against the
consumer that names each one. Nothing described that surface before, which is how
a dead export survived a migration: the names are resolved dynamically at both
call sites (`ra[fn]`), so nothing typed connected them.
