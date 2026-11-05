---
---

Internal refactor only: the CLI session daemon moves its session-file teardown (lock, pidfile ownership check, file removal) from `server.ts` into a sibling module. No behaviour change; releases nowhere.
