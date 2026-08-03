---
"@real-a11y-dev/core": patch
---

`DomObserver` no longer drops its built-in sentinel ids when a caller passes a custom `internalIds` set.

The 4th constructor parameter defaulted to the built-in set, so supplying your own ids **replaced** it rather than adding to it — silently un-filtering `__sn-highlight` and `__sn-curtain`. Mutations from our own focus-highlight overlay and screen curtain would then be observed as user mutations, re-arming the re-extract → re-render → re-highlight feedback loop the filter exists to prevent. The provided set is now unioned with the built-ins, so the built-in sentinels are always filtered.
