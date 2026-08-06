---
"@real-a11y-dev/mcp": patch
---

Fix the published type declarations, which referenced a package that isn't on npm.

`server.d.ts` shipped `import { SessionInfo } from "@real-a11y-dev/session-registry"` — but that package is private and deliberately never published; it is bundled into the server instead. The **JS** bundling always worked. The declarations are a separate emit, and tsup was not told to inline them, so the `.d.ts` kept pointing at a module npm cannot resolve.

For a consumer that meant one of two things, and the second is the reason this went unnoticed:

- with `skipLibCheck: false`, a hard `TS2307` — cannot find module;
- with `skipLibCheck: true` (the common default), **no error at all** — `SessionInfo`, `SessionRegistryError`, and `RegistryShutdownError` silently degraded to `any`, so part of the public `SessionManager` contract stopped type-checking while everything looked fine.

Those three names are part of the contract on purpose: a third-party session manager signals refusals by throwing `SessionRegistryError`, and an error class it cannot import is a contract it cannot implement. They are now inlined into the published declarations, so they arrive with real shapes and nothing points at the private package. `session-registry` stays private and unpublished.

No API change — the same names are exported, from the same entry point.
