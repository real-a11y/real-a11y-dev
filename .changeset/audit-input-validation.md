---
"@real-a11y-dev/testing": minor
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
---

Reject input that isn't a tree, instead of reporting it as a clean page.

Every entry point that accepts `Element | ExtractionResult` resolved the second
branch with an unchecked cast, so anything that wasn't an `Element` — a number,
a string, `{}`, a `Date` — became an empty tree. The rules then found nothing
and the assertion **passed**:

```js
assertNoUnlabeledInteractive(42); // passed silently
collectFindings(42); // 2 findings, about the number
assertLandmarkStructure(42); // threw "Missing <main>" — about the number
auditSnapshot(42); // ""  ← committed, this is a permanently green test
```

The matcher layer already guarded this (`expected a DOM Element, received
number`); the `assert*`, `collectFindings`, `listByRole` and `serialize*`
layers did not. They now throw a `TypeError` naming the function called and the
type received:

```
assertNoUnlabeledInteractive: expected a DOM Element or an extracted a11y tree, received number
```

It is a `TypeError`, never an `A11yAssertionError` — code catching the latter is
handling "this page has issues", and a wrong argument is not that. The message
names the received **type** and never its value, since what lands there by
mistake is often page text or a token.

Unknown rule ids are rejected the same way. `A11yRule` protects a TypeScript
caller writing a literal, but a list built from a config file, a CLI flag or
plain JavaScript reached the runtime unchecked, matched no rules, and passed
having checked nothing — a typo silently deleted the check:

```js
assertRules(page, ["landmark_structure"]); // passed; the real id is landmark-structure
// now: unknown rule "landmark_structure". Known rules: no-unlabeled-interactive, …
```

`formatFindings([])` now reads `No accessibility issues found.` rather than
`Found 0 accessibility issues:` with nothing under it.

**Breaking change.** A call that previously passed can now throw. In every case
the call was already not testing anything — a suite that goes red here was
green while asserting nothing — but it is a behaviour change and can surface as
a newly failing test. Genuine inputs are unaffected: a DOM `Element` and a real
`ExtractionResult` (including a native tree from CDP) behave exactly as before.
The tree check is structural rather than `instanceof`, so a tree that crossed a
realm — an iframe, a worker, a second bundled copy of the engine — still passes.
