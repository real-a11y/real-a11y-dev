---
"@real-a11y-dev/testing": patch
---

`toBeValidA11yTree()` no longer reports DPUB-ARIA (`doc-*`) and Graphics-ARIA (`graphics-*`) roles as `not a valid ARIA role`. Markup such as `<nav role="doc-toc">` now passes, and the other per-node rules (for example the required accessible name on `graphics-document` and `doc-pagebreak`) now apply to these roles. Deprecated `doc-biblioentry` and `doc-endnote` are valid roles, with no deprecation warning. Abstract roles, `video` and other invented tokens are still errors.
Because these roles are now known, the context and owned-element rules apply to them as warnings (for example `doc-biblioentry` outside `doc-bibliography`); `toBeValidA11yTree()` only fails on errors.
