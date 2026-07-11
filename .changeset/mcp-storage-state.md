---
"@real-a11y-dev/mcp": minor
---

`BrowserSession` can now load an authenticated session and pin the audited origin — the engine half of auditing pages behind a login. `BrowserSessionOptions` gains `storageState` (a Playwright storage-state file path, loaded into every launched context so pages open already authenticated; it survives device-emulation context rebuilds and is rejected together with `cdpEndpoint`) and `allowedOrigins` (when set, extraction is refused unless the page's final post-redirect origin is in the allowlist — the control that stops a redirect from an intended target to a recorded cookie domain from silently auditing an unintended authenticated page). A new `captureStorageState()` method returns the current context's cookies + origin storage for a "save the session" flow. Auth material is always caller-configured, never derived from tool input. The agent-facing MCP server surface (env vars, tool descriptions) is unchanged in this release.
