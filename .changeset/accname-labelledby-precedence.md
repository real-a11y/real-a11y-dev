---
"@real-a11y-dev/core": patch
---

Resolve `aria-labelledby` before `aria-label` in accessible-name computation. Per accname-1.2 the `aria-labelledby` reference (§2B) is resolved before the inline `aria-label` (§2D), so an element carrying both — e.g. `<button aria-label="X" aria-labelledby="heading">` — is now named from the referenced text (matching Chrome, Firefox, and NVDA) instead of the inline label. Previously the inline `aria-label` won, producing a name that disagreed with what screen readers actually announce.
