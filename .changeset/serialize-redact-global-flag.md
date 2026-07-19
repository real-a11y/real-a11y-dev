---
"@real-a11y-dev/serialize": patch
---

Fix `serializeTree`/`serializeTreeDiff` redaction leaking repeated matches. `redact` patterns were applied with a plain `String.prototype.replace`, which only replaces the **first** match unless the RegExp is global — so a name or change value holding a pattern twice (two `$`-amounts, two "N minutes ago" timestamps, a repeated token) leaked every occurrence after the first into output that is meant to be a deterministic, PII-free, committable snapshot. Each `redact` pattern is now normalized to global once per serialize call before use (an already-global pattern is left untouched), so **all** occurrences are redacted.
