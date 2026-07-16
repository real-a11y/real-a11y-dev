---
"@real-a11y-dev/core": patch
---

DomObserver: observe mutations _inside_ open portal overlays, not just their mount/unmount. When `root` is a subtree — the `@real-a11y-dev/react` hook and the inspector pass a user root; the extension passes `documentElement` and was unaffected — a Radix/Headless-UI/Teleport modal, menu, or listbox mounts _outside_ `root`, so the primary observer can't see into it. The extractor pivots onto the overlay, but the panel would show its initial state and then go stale on typing, `aria-*` flips, or content/submenu swaps. Now each open portal gets its own deep observer (childList + subtree + attributes + characterData) plus `input`/`change` listeners, torn down when the overlay unmounts or on `stop()`.
