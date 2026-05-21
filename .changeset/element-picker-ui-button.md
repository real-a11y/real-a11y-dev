---
"@real-a11y-dev/semantic-navigator-ui": patch
---

Add `.sn-pick-btn` styles for the DevTools-style element picker toolbar
button. The button itself is rendered by the extension's sidepanel
(`packages/extension`, private), but the styles live alongside the
other toolbar controls (`.sn-curtain-btn`, `.sn-focus-tracker-btn`) so
any consumer that embeds the same chrome and wants to surface a picker
toggle gets the matching look for free. Includes hover, focus-visible,
and `aria-pressed="true"` states.
