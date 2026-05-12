---
"@real-a11y-dev/core": patch
---

Fix the inspector missing portal-mounted modals (Radix Dialog, Headless UI Dialog, Vue Teleport, etc.). The `DomObserver` only watched the configured root; portal content rendered into `document.body` triggered no mutation event, so the extractor never re-ran and the panel stayed on the trigger's pre-open state. A second observer now watches `document.body` at top level only and schedules a re-extract when an added/removed child is or contains a modal-shaped element (`[aria-modal="true"]`, `<dialog>`, `[role="dialog"]`, `[role="alertdialog"]`). Bounded surface — only portal-style body mounts fire it, not every page-level DOM tweak.
