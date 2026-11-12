---
"@real-a11y-dev/testing": patch
---

`toBeValidA11yTree` now follows the WAI-ARIA 1.2 role tables where aria-query 5.3.2 differs. A focusable `separator` without `aria-valuenow` is an error (`missing required aria-valuenow`), and the discard error for an orphaned `option` ends in `(group / listbox)`. Context warnings now follow 1.2 too: `option` belongs in a `listbox` or a `group`, `rowheader` only in a `row`, and `caption` may sit in a `treegrid`. A native `<select>`'s options are unaffected, and a `treeitem` still requires `aria-selected`.
