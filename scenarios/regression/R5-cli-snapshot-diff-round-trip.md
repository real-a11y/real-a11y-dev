---
id: R5
suite: regression
scenario: "CLI `snapshot` → `diff` round-trip, incl. --md, --explain, --only, --fail-on"
area: CLI
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.1. Note: native-producer artifacts re-fingerprint from browser 0.1.0-beta.12 (findings gained locators) — re-baseline once, don't file it"
validUntil: ""
expected: "snapshot writes a schema-valid artifact; diff of identical artifacts → exit 0 + no changes; a tab-stop change is reported as NOT COMPARED, never as removals — the artifact carries no tabs view since #258"
twin: D3
covers:
  - cli.commands.snapshot
  - cli.commands.diff
notion: "https://app.notion.com/p/3aa1c354b0b581488056fb7ec111c33d"
---

## Steps

1. `real-a11y snapshot <url> -o base.json`
2. Validate `base.json` — `schemaVersion`, `pages[]`, findings carrying `v1:`
   fingerprints
3. `real-a11y diff base.json base.json` — identical inputs
4. Change the page: **add one tab stop** near the top, then
   `real-a11y snapshot <url> -o pr.json`
5. `real-a11y diff base.json pr.json` — and read what it says about the **tabs**
   axis specifically
6. **(5b)** Diff a **pre-#258 artifact** (one that carries a tabs view) against a
   current one, if you have one to hand — this is the upgrade path real users hit
   once
7. `real-a11y diff base.json pr.json --explain`
8. `real-a11y diff base.json pr.json --only findings`, then `--only views`
9. `real-a11y snapshot <url> --md -o report.md`
10. `real-a11y diff base.json pr.json --fail-on never`
11. Fix the violation, re-snapshot, diff again
12. `real-a11y snapshot <url> --root main`

## Expected

- **3** — exit `0`, "no changes"
- **5** — **no tabs-axis entries at all**, and the report says why: `skippedViews`
  includes `tabs`, rendered as "Not compared: the tabs view". The added stop is
  invisible to `snapshot`/`diff` since #258 — that is the documented loss, and the
  assertion is that it reads as _not measured_ rather than as nothing-focusable
- **5b** — same: the axis is skipped, **not** reported as N stops removed. One
  side measured tab order and the other didn't; `meta.views` is what lets the
  differ tell those apart. A run that emits "Keyboard tab stop removed" here is
  the regression this guard exists for
- **6** — explains _why_ each entry classified as it did
- **7** — filters to that axis only
- **8** — readable Markdown for a PR comment
- **9** — reports, exits `0`
- **10** — the fixed finding classifies as **fixed**, not fixed-plus-new. Identity
  survives locator churn: re-indentation and a renumbered `:nth-of-type` must not
  re-identify a finding
- **11** — refused, exit `2`, with an explanation rather than the parser's
  "Unknown option". The reason changed at #258: not "scope per route instead" but
  _whole-document_ — `snapshot` reads Chromium's own tree, which has no subtree to
  narrow to. `urls[].rootSelector` no longer scopes it either; a config that sets
  one warns on stderr, names the routes, and keeps running

## Why this exists

This is the CI-diff-bot story end to end, and its value rests entirely on
**finding identity**. A diff that reports "47 changed" when one thing changed gets
ignored, and an ignored gate is no gate.

Two identity traps to check deliberately:

- **Locator churn** (10) — the fingerprint strips `:nth-of-type(N)` from path
  anchors precisely so an inserted sibling doesn't re-identify everything after it.
- **Anchor changes across producers** — there is no `--producer` flag any more
  (#258 removed the axis), so this trap is now a one-time upgrade artifact rather
  than a thing you can trigger by choice: an artifact captured before the
  migration and diffed against one captured after may re-fingerprint. Expected
  once, on that boundary; not a regression. Compare like with like.
- **A skipped axis must never read as an empty one** (5, 5b) — the sharpest
  version of the identity problem, and the reason the migration needed a schema
  change rather than just omitting a field. `parseSnapshotArtifact` used to coerce
  a missing `tabs` back to `""`, which would have turned "we didn't look" into
  "nothing is focusable here" on every page of the first upgrade diff.

## Notes

**Revisited after the producer migration (#258)**, which this row was flagged to
wait for. `snapshot` is native and a native page omits the tabs view entirely, so
steps 4–5 no longer test what they were written to test: adding a tab stop
produces no tabs-axis diff at all. That is the accepted loss — and the thing now
worth asserting is that the diff _says so_ (`skippedViews`, "Not compared: the
tabs view") rather than reporting every stop as removed, which is what an
empty-string tabs view would have done. The single-`+`-line property still exists,
one surface over, on `real-a11y tabs --format json`; see R4 step 8.
