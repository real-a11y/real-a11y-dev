# @real-a11y-dev/session-registry

Internal workspace package — **never published**. Bundled (tsup `noExternal`)
into the packages that embed it, so it must stay free of CLI- or MCP-specific
dependencies.

The one home for named browser-session scheduling, shared by the CLI session
daemon and (per the PR E design) the MCP server:

- `SessionRegistry<T>` — creates a session per name on first use, single-flights
  work within a session, runs different sessions independently, and stops
  everything after an idle timeout (with a startup grace so a short timeout
  cannot race the first run).
- Identity pinning — a session's browser-defining flags (headful, cdp,
  chromePath, storageState, proxy, cwd) are pinned at creation;
  a reuse with different flags throws `SessionIdentityError` instead of
  silently serving the old browser.
- Origin subsetting — a reuse may request a subset of the pinned origin
  allowlist, never a superset (`SessionOriginError`).
- `list()` reports redacted URLs only.

Errors carry a `hint` string; consumers map them to their own error surface
(the CLI daemon maps `RegistryShutdownError` to its retryable `ESHUTDOWN`
RPC code and lets the conflict errors flow through its generic error path).
