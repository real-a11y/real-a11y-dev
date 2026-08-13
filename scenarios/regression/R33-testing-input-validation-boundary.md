---
id: R33
suite: regression
scenario: "Testing pkg — input validation at the assertion and serializer boundary, not just the matcher one"
area: Testing
type: Automated
priority: P0
status: Active
validFrom: "testing ≥ 0.1.0-beta.15. The matcher layer already guards (requireElement in packages/testing/src/matchers.ts); this row is about every OTHER published entry point, which does not."
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
4. `auditSnapshot(value)` / `outlineSnapshot(value)` / `tabSequenceSnapshot(value)`
5. `assertRules(value, ALL_RULES)`
6. The same value through the **matcher** form, for comparison
7. `assertRules(violatingRoot, ["landmark_structure"])` — a rule id that does
   not exist, on a page that genuinely violates `landmark-structure`. The page
   has to be a violating one: on a clean page the step passes either way and
   proves nothing
8. Commit `expect(auditSnapshot(value)).toMatchSnapshot()` and re-run it

## Expected

- **1/2/5** — a thrown error that names the argument problem. Today **1** passes
  silently and **2** throws `A11yAssertionError: Missing <main>` — a real error
  with a message about the wrong subject entirely, which sends the reader to
  look at their markup
- **3** — rejects, rather than returning `heading-order` + `landmark-structure`
  findings **about a number**
- **4** — rejects. Today it returns `""`, and step **8** is why that matters: a
  committed empty snapshot is a permanently green test asserting nothing
- **6** — the matcher rejects (`expected a DOM Element, received number`). The
  gap between **6** and **1** is the finding: the guard exists, one layer up
- **7** — an unrecognised rule id is an error. Today it matches no rules, so the
  assertion passes having checked nothing — a typo silently deletes a check
- `undefined`/`null` throw today, but as a raw
  `TypeError: Cannot read properties of undefined (reading 'nodes')` rather than
  an actionable message

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
