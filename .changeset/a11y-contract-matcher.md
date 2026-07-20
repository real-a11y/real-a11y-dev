---
"@real-a11y-dev/serialize": minor
"@real-a11y-dev/testing": minor
---

Add a11y **contract verification** — assert that a tree satisfies an authored contract instead of snapshotting the whole thing.

A contract is a partial tree in the same `role "name" (level N)` grammar the snapshots use. `@real-a11y-dev/testing` gains a `toMatchA11yContract(contract, { strict? })` matcher (the `toMatchObject` of a11y trees): containment by default with ancestor semantics — every contract node must appear, in order, nested under its parent's match, but **extra nodes in the implementation are allowed**, so a contract survives cosmetic churn and fails only on a structural regression (a `<button>` shipped as a `<div>`, a demoted heading, a field that lost its label). Received may be a DOM Element or an already-serialized string, so a committed snapshot artifact can be checked too; names fold typographic punctuation; `strict: true` switches to exact equality. Failures pinpoint the first missing node and why.

`@real-a11y-dev/serialize` exports `foldTypography` — the accessible-name typography normalizer (curly quotes, ellipsis, dashes, NBSP, NFC), used by the testing package's name matchers at comparison time. Serialized output itself is never folded; it stays faithful to what assistive tech announces.
