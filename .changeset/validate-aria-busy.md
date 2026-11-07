---
"@real-a11y-dev/testing": patch
---

`validateTree` (bundled into `testing`) no longer warns that an empty `listbox`, `list`, `tablist` or other required-owning container "should contain" its owned roles when it or an ancestor is marked `aria-busy="true"`, which WAI-ARIA 1.2 §5.2.6 prescribes for a widget that is still loading. `toBeValidA11yTree` output is unchanged, because the matcher never fails on warnings.
