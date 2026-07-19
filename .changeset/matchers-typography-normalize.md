---
"@real-a11y-dev/testing": patch
---

Match accessible names across typographic punctuation, so smart quotes no longer cause confusing false failures. `toHaveTabSequence` tokens and `flow().expectChanges` `ChangeSpec` names now fold curly quotes/apostrophes, the ellipsis character, en/em dashes, and non-breaking spaces to their ASCII forms before comparing — a hand-typed `button "Don't save"` matches a label the page renders with a curly `Don’t`. Folding happens only at comparison time; serialized snapshots stay byte-faithful to what assistive tech announces, and the whole-diff string form of `expectChanges` is deliberately left literal.
