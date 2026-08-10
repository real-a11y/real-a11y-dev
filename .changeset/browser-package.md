---
"@real-a11y-dev/mcp": minor
"@real-a11y-dev/cli": patch
"@real-a11y-dev/testing": patch
---

Internal re-layering: the browser driver moved into a dedicated `@real-a11y-dev/browser` workspace package, extracted from `@real-a11y-dev/mcp` (the `BrowserSession`) and `@real-a11y-dev/testing` (the injected page-bundle and its IIFE build). It is the one place that touches Playwright: `BrowserSession` drives a real Chromium and injects the page-bundle that installs `window.__realA11y__`. Deps: `@real-a11y-dev/audit` + `@real-a11y-dev/serialize` + `@real-a11y-dev/core`, with an optional `playwright` peer.

> **Note.** That package is **workspace-internal — never install it.** It was published through `0.1.0-beta.13` and is private from the next release on; the same release deprecates it on npm. It is bundled into `mcp`, `cli` and `testing`, which is how this change reaches you. The `0.1.0-beta.13` tarball still resolves its page-bundle by path, the bug that privatizing it fixed.

This completes the platform re-layering. The CLI, the MCP server, and the testing Playwright adapter now all drive the browser through this single package, so a tree captured by any of them is byte-for-byte identical — the bundle is built and resolved in exactly one place.

- **`@real-a11y-dev/mcp`** imports `BrowserSession` from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/testing` dependency entirely** — the page-bundle was its last tie to the test-helper package. It also **removes the `./browser` subpath export**: `BrowserSession`, `A11ySession`, `BrowserSessionOptions`, `PageSnapshot` and `SnapshotOptions` are on `@real-a11y-dev/mcp`'s root export instead of `@real-a11y-dev/mcp/browser`.
- **`@real-a11y-dev/cli`** imports the browser session from `@real-a11y-dev/browser` and **drops its `@real-a11y-dev/mcp` dependency** (it only wrapped mcp for the browser). Installing the CLI no longer pulls in the MCP SDK.
- **`@real-a11y-dev/testing`** keeps its public API unchanged — `@real-a11y-dev/testing/playwright`'s `attach()` behaves identically. Internally its adapter now injects `@real-a11y-dev/browser`'s page-bundle instead of building its own.

Verified byte-for-byte against the CLI, MCP, and testing e2e suites.
