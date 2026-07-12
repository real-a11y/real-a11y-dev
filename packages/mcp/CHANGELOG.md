# @real-a11y-dev/mcp

## 0.1.0-beta.0

### Minor Changes

- 9c3517c: The MCP server can now audit pages behind a login. Set `REAL_A11Y_MCP_STORAGE_STATE` to a saved Playwright storage-state file (create it out-of-band, e.g. with `real-a11y login`) and every page opens already authenticated — the session is operator-configured, never a tool parameter, so tokens never enter the agent's context. `REAL_A11Y_MCP_ALLOWED_ORIGINS` pins auditing to a comma-separated allowlist so a redirect can't route the session to an unintended site (the engine refuses extraction off-allowlist).

  The server validates the storage-state file at startup and refuses to boot if it's missing or malformed (a server that silently audits logged-out pages is worse than one that won't start), and rejects `STORAGE_STATE` combined with `REAL_A11Y_MCP_CDP`. When a session is loaded, `open_page` tells the agent so in its description and result — a boolean fact, never the path or contents — so it doesn't try to "fix" an already-authenticated page by logging in.

- 18dda52: New `@real-a11y-dev/mcp/browser` subpath export: `BrowserSession` (plus `OpenOptions`, `assertOpenableUrl`, and the session types) without loading the MCP SDK graph — the root export's module top-level imports the SDK and zod, which consumers that only want the browser session (like `@real-a11y-dev/cli`) shouldn't pay for. `BrowserSessionOptions` also gains an optional `proxy` pass-through to Chromium's launch options, since Chromium ignores `HTTP_PROXY`/`HTTPS_PROXY` env vars on its own. The playwright peer is now marked optional (`peerDependenciesMeta`) to match the lazy import — importing the server API (or the browser subpath's types) never requires a browser install, and downstream packages with a playwright-free surface no longer inherit an unmet-peer warning. The root export is unchanged.
- 32fc4e6: New package `@real-a11y-dev/mcp` — a Model Context Protocol server that exposes the Real A11y semantic tree and accessibility audits to AI agents over stdio. Point any MCP client at it (`npx -y @real-a11y-dev/mcp`) and an agent can open a page and reason about what assistive tech actually perceives.

  Audit-first: `audit_page` runs the same rule engine as `@real-a11y-dev/testing` (`collectFindings`) and returns every violation — unlabeled controls, skipped heading levels, unlabeled dialogs, broken landmark structure — grouped and with per-instance CSS locators. `inspect_page` returns the findings plus the semantic tree, heading outline, and tab order from ONE extraction, so a multi-view report can't be internally inconsistent on a dynamic page. Perception primitives (`get_semantic_tree`, `get_heading_outline`, `get_tab_order`, `list_elements`) let it stand alone without a separate browser-automation MCP; `open_page` handles navigation, settle waits, and mobile/tablet device emulation.

  Two MCP-only tools cross-check the custom engine against the browser's own tree: `get_native_tree` reads Chromium's authoritative accessibility tree via CDP, and `compare_trees` diffs the two and reports where they disagree on role or accessible name — a fidelity oracle that surfaces custom-engine bugs.

  Playwright is a peer dependency, lazily imported, so importing the server API (`buildServer`, types) never requires a browser to be installed. `file://` navigation is refused by default (an LLM-driven local-file exfiltration primitive) unless `REAL_A11Y_MCP_ALLOW_FILE=1`.

- 18dda52: `BrowserSession` can now load an authenticated session and pin the audited origin — the engine half of auditing pages behind a login. `BrowserSessionOptions` gains `storageState` (a Playwright storage-state file path, loaded into every launched context so pages open already authenticated; it survives device-emulation context rebuilds and is rejected together with `cdpEndpoint`) and `allowedOrigins` (when set, extraction is refused unless the page's final post-redirect origin is in the allowlist — the control that stops a redirect from an intended target to a recorded cookie domain from silently auditing an unintended authenticated page). A new `captureStorageState()` method returns the current context's cookies + origin storage for a "save the session" flow. Auth material is always caller-configured, never derived from tool input. The agent-facing MCP server surface (env vars, tool descriptions) is unchanged in this release.

### Patch Changes

- Updated dependencies [d8eaaf7]
- Updated dependencies [7a56937]
  - @real-a11y-dev/testing@0.1.0-beta.10
