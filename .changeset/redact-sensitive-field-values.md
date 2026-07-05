---
"@real-a11y-dev/core": minor
---

Redact sensitive form-field values at the extraction source. `getKeyAttributes` previously captured the live `.value` of every input/textarea/select — including `type="password"`, one-time codes, and credit-card fields — into `node.dom.attributes.value`, and an unlabeled field's value could surface as its accessible name. Because the extracted tree flows into serializer snapshots (committed to git and CI), the testing package, and the Chrome extension's message channel, a typed secret rode along everywhere.

Now a new `isSensitiveField(element)` predicate (exported from `@real-a11y-dev/core`) identifies password inputs and any field whose `autocomplete` names a credential or payment token. Such a field's value is replaced with `"[redacted]"` in the tree and is never used as an accessible name (the name falls back to the placeholder). Every downstream consumer inherits the fix from the single extraction choke point.
