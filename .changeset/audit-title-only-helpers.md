---
---

Internal refactor, no behaviour change: the audit engine's `label-title-only` check reads a live element and a native-tree node in two helpers of its own. It releases nowhere.
