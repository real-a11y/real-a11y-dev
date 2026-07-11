---
"@real-a11y-dev/mcp": minor
---

New `@real-a11y-dev/mcp/browser` subpath export: `BrowserSession` (plus `OpenOptions`, `assertOpenableUrl`, and the session types) without loading the MCP SDK graph — the root export's module top-level imports the SDK and zod, which consumers that only want the browser session (like `@real-a11y-dev/cli`) shouldn't pay for. `BrowserSessionOptions` also gains an optional `proxy` pass-through to Chromium's launch options, since Chromium ignores `HTTP_PROXY`/`HTTPS_PROXY` env vars on its own. The playwright peer is now marked optional (`peerDependenciesMeta`) to match the lazy import — importing the server API (or the browser subpath's types) never requires a browser install, and downstream packages with a playwright-free surface no longer inherit an unmet-peer warning. The root export is unchanged.
