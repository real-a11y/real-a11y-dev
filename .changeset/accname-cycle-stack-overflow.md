---
"@real-a11y-dev/core": patch
---

Fix a stack-overflow crash in accessible-name computation. Since named-widget descendants began contributing their computed name (PR #101), `getAccessibleTextContent` and `computeRawAccessibleName` could call each other without end when an element's `aria-labelledby` points at an ancestor that contains it — a real pattern that threw `RangeError: Maximum call stack size exceeded` out of `extractA11yTree` and froze the inspector (observed on mercadolibre.com.mx's signup form).

Name computation now follows the accname visit-once rule (§4.3.2): an element already on the current computation path contributes the empty string when reached again, breaking the cycle while leaving every non-cyclic name unchanged. A `visited` set is threaded through `computeAccessibleName` / `computeRawAccessibleName` / `getAccessibleTextContent`, and `aria-describedby` resolution is guarded the same way.
