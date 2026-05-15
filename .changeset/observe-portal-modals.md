---
"@real-a11y-dev/core": patch
---

Fix the inspector missing portal-mounted overlays (Radix Dialog / DropdownMenu / Toast, Headless UI, Vue Teleport, etc.). The `DomObserver` only watched the configured root, and the extractor only pivoted scope when a modal was active — so portals rendered into `document.body` (modals, dropdown menus, listbox popovers, tooltips, and live-region toasts) triggered no mutation event and never joined the tree. A second observer now watches `document.body` at top level only and re-extracts on portal mounts; `extractDomTree` resolves the effective root in three priority levels — active modal (exclusive scope) > portal overlay outside root (pivot to `body`) > configured root. Selector covers `[aria-modal="true"]`, `<dialog>`, `[role="dialog"|"alertdialog"|"menu"|"menubar"|"listbox"|"tooltip"|"status"|"alert"|"log"]`, and `[aria-live]`. Bounded surface — non-overlay body mounts (analytics divs, script tags) don't trigger re-extracts.
