---
id: R33
suite: regression
scenario: "Testing pkg — input validation at the assertion and serializer boundary, not just the matcher one"
area: Testing
type: Automated
priority: P0
status: Active
validFrom: "testing ≥ 0.1.0-beta.15 for the row; the guard itself ships in the FIRST release after 0.1.0-beta.15. The matcher layer always guarded (requireElement in packages/testing/src/matchers.ts) — this row is about every OTHER published entry point, which did not. Running it against 0.1.0-beta.15 or earlier reproduces the defect rather than failing the test: there, the assert*/collectFindings/serialize* calls pass silently and treeSnapshot returns an empty string. That is the old behaviour, not a fail."
validUntil: ""
expected: "every published entry point rejects a non-Element, non-tree argument instead of reporting a clean page"
twin: D5
covers:
  - packages.@real-a11y-dev/testing
  - packages.@real-a11y-dev/audit
  - packages.@real-a11y-dev/serialize
notion: ""
---

## Steps

For each value in `undefined`, `null`, `"<button></button>"`, `42`, `true`, `{}`,
`[]`, `new Date()` — call each of these and record what happens:

1. `assertNoUnlabeledInteractive(value)` and `assertDialogsLabeled(value)`
2. `assertHeadingOrder(value)` and `assertLandmarkStructure(value)`
3. `collectFindings(value)` — and read the findings it returns
4. `treeSnapshot(value)` / `outlineSnapshot(value)` / `tabSequenceSnapshot(value)`
5. `assertRules(value, ALL_RULES)`
6. The same value through the **matcher** form, for comparison
7. `assertRules(violatingRoot, ["landmark_structure"])` — a rule id that does
   not exist, on a page that genuinely violates `landmark-structure`. The page
   has to be a violating one: on a clean page the step passes either way and
   proves nothing
8. Commit `expect(treeSnapshot(value)).toMatchSnapshot()` and re-run it

## Expected

- **1/2/5** — a `TypeError` naming the function called and the type received:
  `assertNoUnlabeledInteractive: expected a DOM Element or an extracted a11y
  tree, received number`. It must be a `TypeError`, **never** an
  `A11yAssertionError` — code catching the latter is handling "this page has
  issues", and a wrong argument is not that
- **3** — rejects, rather than returning `heading-order` + `landmark-structure`
  findings **about a number**
- **4** — rejects. Step **8** is why that matters: an empty string committed
  through `toMatchSnapshot()` is a permanently green test asserting nothing
- **6** — the matcher rejects too, and always did. **6** vs **1** was the whole
  finding: the guard existed one layer up, so testing only the matcher tested
  the half that already worked
- **7** — an unrecognised rule id is an error listing the valid ids. Matching no
  rules and passing is indistinguishable from checking nothing, so a typo
  silently deleted a check
- **`undefined`/`null`** get the same actionable message, not the raw
  `TypeError: Cannot read properties of undefined (reading 'nodes')`
- The message names the received **type** and never its value — what arrives
  here by mistake is often page text or a token
- A tree that crossed a realm (iframe, worker, a second bundled copy of the
  engine) still passes: the check is structural, not `instanceof`

## Why this exists

R13 step 6 already names this failure mode — "a matcher that quietly accepts
junk and passes turns an entire suite into decoration, and it does so silently
and permanently". It tests it through the **matcher**, which is the layer that
already validates. Everything else — the four `assert*` helpers, `assertRules`,
`collectFindings`, and all three serializers — reaches `toTree()` in
`packages/audit/src/index.ts`, which casts any non-`Element` straight to
`ExtractionResult` with no shape check.

The `Element | ExtractionResult` union is deliberate and worth keeping: auditing
a pre-extracted tree (a native one from a real browser) is a real feature. What
is missing is the other half of the branch — nothing asks whether the thing
being treated as a tree is one.

Step 7 is the same defect wearing different clothes. `A11yRule` is a union type,
so a TypeScript caller is protected at compile time; a rule list built from a
config file, a CLI flag, or plain JavaScript is not, and the failure is
invisible because "no findings" and "no rules ran" are the same outcome.

## Notes

Found from the registry in a fresh project, not in-repo — the workspace's own
tests always pass a real element, which is exactly why this survived.
