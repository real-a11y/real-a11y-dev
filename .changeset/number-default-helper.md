---
---

Internal refactor, no behaviour change: the CLI's config loader checks a numeric `defaults` value, and clamps `sessionIdleTimeout`, in a helper of its own. It releases nowhere.
