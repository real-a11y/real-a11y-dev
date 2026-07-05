---
"@real-a11y-dev/core": patch
---

Stop non-modal dialogs from hijacking the extraction scope. `findActiveModal` treated **any** visible `role="dialog"` / `role="alertdialog"` as the active modal and made it the _exclusive_ extraction root — so a cookie-consent banner, a Radix `Popover.Content`, or a non-modal drawer collapsed the whole page down to just that element in the inspector.

Modality is now gated on a positive signal via a new `isModal()` predicate: `aria-modal="true"` (set by every mainstream modal library — Radix Dialog, Headless UI, MUI — and by the APG dialog pattern) or the native `:modal` pseudo-class (a `<dialog>` opened with `showModal()`). A bare `role="dialog"` is treated as an _additive_ overlay — it joins the tree through the portal path instead of hijacking the scope. Genuine modals still pivot exclusively, exactly as before.
