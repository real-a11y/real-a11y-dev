---
"@real-a11y-dev/core": patch
---

Whitespace-normalize accessible names at the source. Runs of whitespace — including the stray newlines and indentation some pages leave inside their markup — now collapse to a single space and are trimmed, per accname-1.2 §4.3.2. Previously a name could carry raw newlines (e.g. an Amazon `<h3>` whose name smeared across many lines in serialized output), which surfaced in snapshots, exports, and name-based search. Normalizing in `computeAccessibleName` means every consumer — the panel, search, the serializer, and the testing snapshots — sees the same clean string.
