---
id: R6
suite: regression
scenario: "CLI `inspect` — single-extraction snapshot is internally consistent"
area: CLI
type: Automated
priority: P1
status: Active
validFrom: "cli ≥ 0.1.0-beta.1. Tab order LEFT the output at the native-only migration (#258) — an accepted loss, already landed, not a regression to file. Steps below assume the post-#258 output."
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
   - there is **no tab-order section** to cross-read — see Expected 1
3. `real-a11y inspect <url> --include-generic`
4. `real-a11y inspect <url> --format json`
5. `real-a11y inspect <url> --producer native`
6. `real-a11y inspect <url1> <url2>`

## Expected

- **1** — one output: findings **plus** tree **plus** outline. **No tab order** —
  that left at #258 and is not coming back, because pairing a native tree with a
  second, DOM-derived tab-order read would break the one promise this command
  makes. `real-a11y tabs` is the tab sequence. Views print first, the gate outcome
  last
- **2** — no section contradicts another. This is the point of the command: they
  all describe the same instant
- **4** — one parseable document
- **5** — exit `2`. The flag does not exist — #258 deleted the producer axis
  outright — so this is the strict parser's generic unknown-option error, not a
  guidance-carrying refusal. `--root` is the only flag with a named one. Assert the
  exit code, not the wording
- **6** — refused; `inspect` is single-URL

## Why this exists

`inspect` exists so a report cannot be internally inconsistent. Run the views
separately on a page that mutates and they _will_ disagree — each is a fresh
extraction at a different moment. Step 2 is therefore the actual test; step 1
alone would pass a broken implementation that just calls the four views in a row.

**Resolved:** the native-only migration **has landed**, and `inspect` lost tab order
with it. `commands/inspect.ts` states the reasoning directly — a native tree carries
no tab order, and pairing one with a second, DOM-derived read would break exactly the
same-instant promise the command exists for. An accepted loss, recorded when
native-only was chosen; do not file it as a regression, and do not look for the
section.

## Notes

This row previously described the loss as pending ("until it lands, tab order is
still present"), which outlived the migration by several releases and would have sent
a runner looking for a section that no longer prints. Restated as settled, in the
same style R4 and R9 use for their own resolved predictions.

Worth noting what the mechanical checks did and didn't do here: the coverage gate
confirmed `inspect` still ships and still has a scenario. It cannot see that a step
inside the row describes output the command stopped producing — that granularity is
still human.
