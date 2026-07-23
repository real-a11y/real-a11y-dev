---
"@real-a11y-dev/semantic-navigator-ui": patch
---

Add APG first-character / multi-character type-ahead to the panel's composite widgets. Typing printable characters on the focused `role="tree"` or `role="listbox"` container moves selection to a row whose accessible name starts with the typed buffer (500ms idle window; multi-character prefixes keep a still-matching selection; repeating the same letter cycles matches). `/` is reserved for focusing the search input. Covers `useTreeKeyboard` (TreePanel / extension tree) plus FilteredList and TabSequenceView in both the shared UI package and the extension side panel. The README already advertised type-ahead — this makes the claim true. The shared helper is re-exported as `@internal` for the extension forks only (not a versioned public API). Extension InputPanel SelectPicker type-ahead is out of scope. Size budgets: UI 7.8 → 8.2 KB, inspector 30.4 → 30.8 KB gzipped (inspector re-bundles the UI helper).
