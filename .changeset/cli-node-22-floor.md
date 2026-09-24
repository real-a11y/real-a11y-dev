---
"@real-a11y-dev/cli": minor
---

**Breaking: the CLI now requires Node.js 22.12 or newer** (`engines` was `>=20`).

The CLI advertised Node 20, but `real-a11y install` downloads Chrome through `@puppeteer/browsers`, whose current major needs Node 22.12. So installing the CLI on Node 20 always printed `EBADENGINE Unsupported engine: @puppeteer/browsers@3.x`, which read like a broken install while everything actually worked.

Pinning `@puppeteer/browsers` back to 2.x would have silenced it, but 2.x depends on `extract-zip ≤ 2.0.1`, which has two high-severity path-traversal advisories and no fixed release. Every project installing the CLI would then see three high-severity findings in `npm audit`. The 3.x line dropped that dependency. Node 20 reached end-of-life in April 2026, so the floor now says what the CLI actually needs.

On Node 20, npm now warns about `@real-a11y-dev/cli` itself rather than one of its dependencies. Upgrade to Node 22.12+ (or 24) to clear it.

A new test fails the build whenever any package the CLI installs requires a newer Node than the CLI's own `engines` floor, so this mismatch can't come back quietly with a future dependency bump.
