---
"@real-a11y-dev/mcp": minor
---

Named browser sessions for the MCP server.

Every page tool gains an optional `session` parameter (1–32 chars, `A–Z a–z 0–9 _ -`, default `"default"`): separate names are independent live pages with their own findings checkpoints and tree checkpoint, calls within one session are serialized automatically, and different sessions run in parallel — the same registry semantics as the CLI's `--session` daemon, embedded in-process. Sessions launch lazily, are capped by `REAL_A11Y_MCP_MAX_SESSIONS` (default 4), and close on `REAL_A11Y_MCP_SESSION_IDLE_TIMEOUT_MS` (default 15 min) or `close_browser`. Both variables must be non-negative integers — hex, fractions, and stray whitespace no longer parse into a limit nobody chose.

Findings checkpoints outlive their browser: the idle timeout closes pages but keeps the store, because the cross-deploy workflow it exists for (checkpoint prod, review, diff a preview) routinely spans more than 15 minutes. `close_browser` remains the one thing that discards them, and the checkpoint-only tools (`list_checkpoints`, `diff_checkpoints`, `export_checkpoint`, `import_checkpoint`) read the store without launching a browser or spending a session slot.

Tool surface: new `list_sessions` (name, redacted URL, busy state, timestamps); `close_browser` now takes `session` and `all`, which are not combinable. Auth is unchanged and deliberately session-agnostic: every named session inherits the operator's env-configured storage state / origin allowlist, and `session` never carries credentials.

`buildServer` now accepts a `SessionManager` (exported, with `McpSessionManager`, `singleSessionManager`, `SessionInfo`, `SESSION_NAME_RE`, and the `SessionRegistryError` / `RegistryShutdownError` classes a custom manager signals refusals with). Passing an `A11ySession` keeps the existing single-page behavior for the default session; on that path a _named_ session is now refused with a remedy rather than silently resolving to the same page and the same checkpoint store.
