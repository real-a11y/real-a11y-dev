---
"@real-a11y-dev/cli": patch
---

Internal restructure: the daemon's `SessionRegistry` moved into the private workspace package `@real-a11y-dev/session-registry` (bundled into the CLI dist), so the upcoming MCP session support can embed the identical scheduling, identity-pinning, and idle-timeout semantics. No behavior change — the registry code, its tests, and the daemon E2E suite are unchanged apart from the package boundary and consumer-neutral error types.
