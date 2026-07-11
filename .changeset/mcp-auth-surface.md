---
"@real-a11y-dev/mcp": minor
---

The MCP server can now audit pages behind a login. Set `REAL_A11Y_MCP_STORAGE_STATE` to a saved Playwright storage-state file (create it out-of-band, e.g. with `real-a11y login`) and every page opens already authenticated — the session is operator-configured, never a tool parameter, so tokens never enter the agent's context. `REAL_A11Y_MCP_ALLOWED_ORIGINS` pins auditing to a comma-separated allowlist so a redirect can't route the session to an unintended site (the engine refuses extraction off-allowlist).

The server validates the storage-state file at startup and refuses to boot if it's missing or malformed (a server that silently audits logged-out pages is worse than one that won't start), and rejects `STORAGE_STATE` combined with `REAL_A11Y_MCP_CDP`. When a session is loaded, `open_page` tells the agent so in its description and result — a boolean fact, never the path or contents — so it doesn't try to "fix" an already-authenticated page by logging in.
