---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

The native tree no longer names a node after a hidden sensitive field. An `aria-hidden` (or otherwise ignored) card or password input still labels whatever points at it with `aria-labelledby`, and Chromium names that node after the field's value, so `<div role="region" aria-labelledby="card">` around a hidden `<input id="card" autocomplete="cc-number">` read `region "378282246310005"`. Chromium sends no value for an ignored field, so it was taken for empty and its name left alone; it now reads `[redacted]`, as a visible field's already did.
