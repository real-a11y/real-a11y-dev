---
"@real-a11y-dev/core": patch
---

Stop an empty live-region announcer from permanently pivoting the extraction scope to `document.body`. `findPortalOverlay` pivoted for **any** matching overlay outside the configured root that passed a visibility check — and visibility is display/visibility only, so the permanent, empty announcer or toast viewport that every toast library (Sonner, react-hot-toast, Radix Toast, MUI Snackbar) mounts at body level on first render counted as a showing overlay. Because those shells are never removed, the pivot was never released either: with `createInspector({ root: '#app' })` the `root` option was dead for the rest of the session, not just while a toast was up.

The pivot now also requires the overlay to actually have something in it — collapsed text, a focusable descendant, or a graphic. An overlay that is genuinely showing still pivots exactly as before, including an icon-only menu with no text at all; only the empty shells are ignored.
