---
"@real-a11y-dev/serialize": patch
---

Fix `serializeOutline` and `serializeTabSequence` silently ignoring the `redact` option. Both functions accept `SerializeOptions` — whose `redact` is documented as stripping matching substrings from accessible names — but neither applied it: the heading outline emitted `e.name` raw and the tab sequence emitted `n.a11y.name` raw, so passing `redact` was a no-op that leaked user data / timestamps into output meant to be a deterministic, PII-free, committable snapshot. Both now normalize each `redact` pattern to global once per call (matching `serializeTree`/`serializeTreeDiff`) and mask **every** occurrence of every pattern.
