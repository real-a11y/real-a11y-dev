---
"@real-a11y-dev/cli": minor
---

Session daemon lifecycle and hardening.

- Adds `real-a11y session list|stop|stop-all` to inspect and terminate daemon sessions.
- `--session-idle-timeout <ms>` caps how long a daemon stays warm (default 15 min, max 1 hour) and resets after each run.
- Session names are sanitized and stored per-user under `~/.real-a11y/sessions/`, with `0o600` Unix sockets or Windows named pipes with a random per-session name (`\\.\pipe\real-a11y-<id>`; the id is independent of the auth token, which is still required on every RPC).
- Orphan cleanup: stale pidfiles/sockets are detected and removed by `list`/`stop`/`stop-all`; a CLI version/protocol handshake auto-restarts incompatible daemons.
- Daemon log is written to `~/.real-a11y/sessions/<name>/daemon.log`.
- `snapshot` and `audit` are now routed through the daemon and reuse the live page when the current URL already matches the target.
- `--storage-state` now origin-pins `snapshot` the same way it already pinned `audit` and `inspect`; use `--audit-origin` if you need to allow additional origins.
