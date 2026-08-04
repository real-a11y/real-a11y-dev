---
"@real-a11y-dev/mcp": minor
---

Named browser sessions for the MCP server.

Every page tool gains an optional `session` parameter (1–32 chars, `A–Z a–z 0–9 _ -`, default `"default"`): separate names are independent live pages with their own findings checkpoints and tree checkpoint, calls within one session are serialized automatically, and different sessions run in parallel — the same registry semantics as the CLI's `--session` daemon, embedded in-process. Sessions launch lazily, are capped by `REAL_A11Y_MCP_MAX_SESSIONS` (default 4), and close on `REAL_A11Y_MCP_SESSION_IDLE_TIMEOUT_MS` (default 15 min) or `close_browser`.

Tool surface: new `list_sessions` (name, redacted URL, busy state, timestamps); `close_browser` now takes `session` and `all`. Auth is unchanged and deliberately session-agnostic: every named session inherits the operator's env-configured storage state / origin allowlist, and `session` never carries credentials.

`buildServer` now accepts a `SessionManager` (exported, with `McpSessionManager` and `singleSessionManager`); passing an `A11ySession` keeps working exactly as before — existing embedders and their tests run unmodified against the single default page.
