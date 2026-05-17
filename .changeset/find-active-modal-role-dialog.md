---
"@real-a11y-dev/core": patch
---

Fix the inspector failing to pivot scope onto modal dialogs that don't carry `aria-modal="true"`. Radix Dialog ≥1.1 (and several other modern libs — Headless UI, Reach UI) intentionally omit `aria-modal` and enforce modality via sibling-`aria-hidden` + focus trap instead. `findActiveModal` only matched `[aria-modal="true"]` and `dialog:modal`, so a Radix-style dialog opened in the page produced no pivot — the panel kept showing the underlying chrome instead of the dialog content. The selector now also matches visible `[role="dialog"]` and `[role="alertdialog"]` elements; the existing `isActuallyVisible` ancestor-chain check still filters out closed/unmounted dialogs.
