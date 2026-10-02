---
---

No release. Refactor only: the role map and `nativeStates` now read a `<select>`'s drop-down shape through one helper, `isDropDownSelect`, next to `selectRoleFromAttributes` in `core`'s role map, instead of each building the attributes it reads. No change to behavior — present only to satisfy the `changeset` CI gate on `packages/*/src/` edits.
