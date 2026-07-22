---
"@real-a11y-dev/core": patch
---

Cache `getComputedStyle` once per element during extraction and share it across the subtree-hidden / visually-hidden / sr-only / AT-hidden checks. Previously a kept non-interactive node could call `getComputedStyle` up to five times, and name computation repeated `isSubtreeHidden` (another style resolve) for every descendant. Also fold the overlapping hidden-attr / CSS checks so `isHiddenFromAT` builds on `isSubtreeHidden` instead of re-implementing them — a drift hazard when a future condition was added to only one of the two.
