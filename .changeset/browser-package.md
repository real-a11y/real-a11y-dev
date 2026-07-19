---
"@real-a11y-dev/browser": minor
"@real-a11y-dev/mcp": minor
"@real-a11y-dev/cli": patch
"@real-a11y-dev/testing": patch
---

New package `@real-a11y-dev/browser` — the browser driver, extracted from `@real-a11y-dev/mcp` (the `BrowserSession`) and `@real-a11y-dev/testing` (the injected page-bundle and its IIFE build). It is the one place that touches Playwright: `BrowserSession` drives a real Chromium and injects the page-bundle that installs `window.__realA11y__`. Deps: `@real-a11y-dev/audit` + `@real-a11y-dev/serialize` + `@real-a11y-dev/core`, with an optional `playwright` peer.

This completes the platform re-layering. The CLI, the MCP server, and the testing Playwright adapter now all drive the browser through this single package, so a tree captured by any of them is byte-for-byte identical — the bundle is built and resolved in exactly one place.

- **`@real-a11y-dev/mcp`** imports `BrowserSession` from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/testing` dependency entirely** — the page-bundle was its last tie to the test-helper package. It also **removes the `./browser` subpath export**: import `BrowserSession` / `A11ySession` / `OpenOptions` / … from `@real-a11y-dev/browser` instead of `@real-a11y-dev/mcp/browser`.
- **`@real-a11y-dev/cli`** imports the browser session from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/mcp` dependency** (it only wrapped mcp for the browser). Installing the CLI no longer pulls in the MCP SDK.
- **`@real-a11y-dev/testing`** keeps its public API unchanged — `@real-a11y-dev/testing/playwright`'s `attach()` behaves identically. Internally its adapter now injects `@real-a11y-dev/browser`'s page-bundle (via the exported `PAGE_BUNDLE_PATH`) instead of building its own.

Verified byte-for-byte against the CLI, MCP, and testing e2e suites.
