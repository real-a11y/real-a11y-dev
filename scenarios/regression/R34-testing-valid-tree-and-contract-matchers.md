---
id: R34
suite: regression
scenario: "Testing pkg — toBeValidA11yTree and toMatchA11yContract, the two matchers R13 does not name"
area: Testing
type: Automated
priority: P1
status: Active
validFrom: "testing ≥ 0.1.0-beta.15 for the row; the implicit-role split ships in the FIRST release after 0.1.0-beta.15. Running steps 1–3 against 0.1.0-beta.15 or earlier reproduces the defect rather than failing the test — there a bare `select` reports six violations and a captioned `table` reports a missing name. That is the old behaviour, not a fail. `toBeValidA11yTree` is backed by `validate`, which is PRIVATE and bundled — there is no validate version to pin, so assert against `@real-a11y-dev/testing` only. `toMatchA11yContract` is backed by `verifyContract` in packages/testing/src/contract.ts, deliberately INTERNAL to this package until a second consumer appears. The shipped JSDoc claims it comes from `serialize`; that is stale, and it is what this row was first written from."
validUntil: ""
expected: "toBeValidA11yTree flags authored-ARIA mistakes and NOT native HTML; toMatchA11yContract matches by containment, is strict on demand, and never passes vacuously"
twin: D5
covers:
  - packages.@real-a11y-dev/testing
  - packages.@real-a11y-dev/validate
notion: ""
---

## Steps

**`toBeValidA11yTree`** — run each of these and compare the two halves:

1. Native, no ARIA authored anywhere: `<select>` with `<option>`s;
   `<input type="checkbox">`, both checked and unchecked; `<input type="radio">`;
   `<table>` whose only name is a `<caption>`
2. The same semantics written by hand: `role="combobox"` with `role="option"`
   children; `role="checkbox"` with no `aria-checked`
3. A page that is genuinely fine — `<button>`, `<a href>`, a labelled text input
4. An invalid role, and a real relationship violation (interactive nesting)

**`toMatchA11yContract`** — 5 to 9:

5. A contract the tree satisfies; then add unrelated content and re-run
6. Remove a control the contract names; rename one; change one's **role** while
   keeping its name
7. `{ strict: true }` against the exact serialization, and against a tree with
   one addition
8. Pass an already-serialized tree string as the received value
9. An **empty** contract string, and the `.not` form of both matchers

## Expected

- **1** — no violations. A native `<select>` gets expanded/controls semantics
  from the user agent, a native checkbox exposes `checked` through the DOM
  property, `option` inside `combobox` is the required structure for a
  `<select>`, and a `<caption>` **is** the table's accessible name
- **2** — violations, correctly: this is the author who has to supply the state
  themselves
- **1 vs 2** — the whole point. Same reported violations for both means implicit
  roles are being judged by explicit-ARIA rules
- **5** — containment: extra nodes never break a contract
- **6** — all three fail, including the role change. Name-only comparison would
  miss "still reads *New ticket*, no longer operable"
- **7** — strict rejects the addition containment allows
- **9** — an empty contract **throws**. A contract file truncated to zero bytes
  must never read as "satisfied"; `.not` must reject junk rather than inverting
  into a vacuous pass

## Why this exists

The package ships **seven** matchers. R13 enumerates five, and has since before
these two existed — so the only two matchers with no row are also the two with
the most behaviour behind them: a whole validation engine and a whole contract
format, both in packages that are now private and reachable only here.

The `1 vs 2` split is the substance. A validator that cannot tell an implicit
role from an authored one produces a wall of violations on ordinary markup, and
the cost is not a wrong line in a report — it is that the first real page a new
user points it at returns a dozen findings they can see are wrong, and they turn
the matcher off and never come back.

`toMatchA11yContract` is the opposite risk: containment matching is forgiving by
design, so its failure mode is passing when it should not. Step 9 is the floor.
