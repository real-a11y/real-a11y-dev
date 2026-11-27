---
---

Internal refactor, no behaviour change: `core`'s `applySearchFilter` moves its role-filter match into a helper and drops a guard that `matchesRoleFilter` already applies. Every carrier's tree filter marks the same nodes and reports the same count, so this releases nowhere.
