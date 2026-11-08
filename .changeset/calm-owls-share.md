---
---

Internal refactor with no behaviour change: the CLI daemon's three copies of "stop the pidfile's live process or fail" share one helper in `spawn.ts`.
