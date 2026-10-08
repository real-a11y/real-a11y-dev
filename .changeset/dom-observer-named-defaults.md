---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

Internal: `DomObserver`'s default debounce (300 ms) and ceiling (1000 ms) are now named constants, shared with the Chrome extension's native auto-refresh. The values, and when the tree refreshes, are unchanged.
