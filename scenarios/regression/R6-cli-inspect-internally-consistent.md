---
id: R6
suite: regression
scenario: "CLI `inspect` — single-extraction snapshot is internally consistent"
area: CLI
type: Automated
priority: P1
status: Active
validFrom: "cli ≥ 0.1.0-beta.1. Tab order drops out of the output at the native-only migration — accepted loss, not a regression"
validUntil: ""
expected: "one output containing findings + tree + outline, all describing the same instant — the point is that the views cannot disagree, so check them against each other, not just for presence"
covers:
  - cli.commands.inspect
notion: "https://app.notion.com/p/3aa1c354b0b581cf81d6e0e6490009ed"
---

## Steps

Use a page whose accessible content changes shortly after load (a late-hydrating
widget), so a multi-extraction implementation would visibly disagree with itself.

1. `real-a11y inspect <url>`
2. Cross-read the sections against each other:
   - every finding's locator points at a node the **tree** section actually
     contains
   - every heading in the **outline** appears in the tree with the same level
   - _(while it ships)_ every tab stop in the **tab order** appears in the tree
3. `real-a11y inspect <url> --include-generic`
4. `real-a11y inspect <url> --format json`
5. `real-a11y inspect <url> --producer native` _(rejected today; see Why)_
6. `real-a11y inspect <url1> <url2>`

## Expected

- **1** — one output: findings **plus** tree **plus** outline (plus tab order
  until the migration). Views print first, the gate outcome last
- **2** — no section contradicts another. This is the point of the command: they
  all describe the same instant
- **4** — one parseable document
- **5** — refused with guidance rather than silently ignored
- **6** — refused; `inspect` is single-URL

## Why this exists

`inspect` exists so a report cannot be internally inconsistent. Run the views
separately on a page that mutates and they _will_ disagree — each is a fresh
extraction at a different moment. Step 2 is therefore the actual test; step 1
alone would pass a broken implementation that just calls the four views in a row.

**Transition:** the native-only migration makes `inspect` **lose tab order**,
because the native producer has none. That is an accepted loss recorded when
native-only was chosen — do not file it as a regression. Until it lands, tab order
is still present and still has to agree with the rest.

## Notes

Native-only migration: `inspect` LOSES tab order (the native producer has none).
Accepted loss, not a regression — don't file it. Until that PR lands, tab order is
still in the output and should still be consistent with the rest.
