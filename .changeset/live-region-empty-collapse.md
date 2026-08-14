---
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/react": patch
---

Internal stylesheet change, no behaviour change for these packages. The shared
`tree.css` they bundle gains collapse rules for live-region containers that are
mounted while still empty (`.sn-search-count:empty`, `.sn-live-log:empty`) and
splits the action-feedback bar's paint onto an inner `.sn-action-feedback-text`
so its flash still replays. Only the Chrome extension renders those containers
today, so nothing these packages render changes; the inspector's size budget
moves 33.5 kB → 33.8 kB to cover the added rules.
