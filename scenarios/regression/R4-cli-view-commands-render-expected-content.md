---
id: R4
suite: regression
scenario: "CLI view commands — tree / outline / list all render expected content"
area: CLI
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.1. Step 8 has no end date — `tabs` was expected to be removed by the native migration and was not (#258 kept it on DOM). Step 4b is from cli ≥ 0.1.0-beta.2; on an earlier release an empty category prints a bare `(none)`, which is the old behaviour, not a fail."
validUntil: ""
expected: "tree shows role+name lines; outline shows h1/h2; list filters by category, and an empty category explains itself (scanned count + the roles it looked for) rather than printing a bare (none). Assert against `real-a11y --help`'s own command list, not a hardcoded set."
twin: D2
covers:
  - cli.commands.tree
  - cli.commands.outline
  - cli.commands.list
  - cli.commands.tabs
notion: "https://app.notion.com/p/3aa1c354b0b581fb801dd6cfa3c6d43e"
---

## Steps

Derive the list to test from the tool itself, so this row cannot rot the way the
command count did:

```bash
real-a11y --help          # enumerate the view commands from here
```

1. `real-a11y tree <url>`
2. `real-a11y tree <url> --include-generic`
3. `real-a11y outline <url>`
4. `real-a11y list image <url>` — then `link`, `button`, `form`, `landmark`,
   `heading`
   - **(4b)** `real-a11y list image <url>` against a fixture whose graphics are
     `<figure>`s rather than `<img>` — a category that legitimately matches nothing
5. `real-a11y list nonsense <url>`
6. `real-a11y tree <url> --format json`
7. Every view command against the violating fixture
8. `real-a11y tabs <url>` in a terminal, then `--format json`. Also
   `real-a11y tabs <url> --root <selector>` — the only command that still accepts
   `--root`

## Expected

- **1** — indented `role "name"` lines; the focused node marked `[focused]`
- **2** — `generic` containers appear; without the flag they don't
- **3** — `h1`/`h2`… in document order
- **4** — only that category, each with role + accessible name + locator
- **4b** — **not** a bare `(none)`. From cli ≥ 0.1.0-beta.2:
  `(none — filter "image" matched 0 of N nodes; it looks for role img)`. Two
  things to check, because each guards a different confusion: **N must be the real
  tree size** (a `0 of 0` here would mean the page never loaded, which is a
  different problem), and the **role list** is what explains the miss — `image`
  looks for exactly `img`. Exit `0`; an empty category is not an error
- **5** — exit `2` naming the valid categories
- **6** — one parseable document
- **7** — exit **`0`**. View commands are not gates: they exit non-zero only when
  something actually failed
- **8** — tab order **numbered** in the terminal, **unnumbered** under
  `--format json`. The numbers are a reading aid; baking them into machine output
  makes every insertion renumber everything after it and turns one change into a
  cascade. `--root` scopes the walk; every other command rejects the flag with an
  explanation rather than the parser's "Unknown option"

## Why this exists

The "not a gate" rule in (7) is easy to break by making views share the audit's
exit path — which would fail CI for a page someone only wanted to _look_ at.

(4b) exists because a bare `(none)` gave one answer to three different questions —
the page has none of these, nothing was extracted, or the category doesn't cover
the role you meant. A runner who sees only `(none)` cannot tell a working command
from a broken page, and the two need opposite responses. `landmark` including the
`form` role while the `form` filter does not is the sharpest case: it looks like a
bug until the roles are printed.

The numbered/unnumbered split in (8) is the subtler one. It was written to keep
`snapshot` → `diff` reporting one added tab stop as one line rather than a wall of
renumbering — and since **#258 the snapshot artifact carries no tabs view at
all**, so that specific justification is now historical. The split still holds and
still matters, one level down: `--format json` is the canonical unnumbered form
anything machine-readable consumes, and a legacy numbered artifact still diffs
cleanly because the differ strips `NN.` before comparing.

## Notes

**Producer migration (#258) — `tabs` SURVIVES, on the DOM producer.** It is the
only source of tab-order _sequence_, not a fallback: native knows per-node
`focusable`, but `tabindex` never reaches a native node, so ordering is DOM/layout
work Chromium's AX tree doesn't expose. Step 8 is permanent, not transitional.
Two consequences: `tabs` is the only command that still takes `--root`, and the
snapshot artifact no longer carries a tabs view at all — so (8)'s
numbered/unnumbered split now matters for `tabs --format json`, not for
snapshot→diff.

**Resolved, opposite to the prediction:** this row expected the native migration
to delete `tabs`, and said a `tabs` invocation must then exit `2`. It does not.
#258 kept `tabs` on the DOM producer deliberately — "the _only_ source, not a
fallback" — because native cannot produce the sequence. Running step 8 and
asserting exit `0` is correct, permanently. A `tabs` command that exited `2`
would now be the regression.
