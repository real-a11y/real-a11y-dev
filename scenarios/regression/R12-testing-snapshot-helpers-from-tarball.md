---
id: R12
suite: regression
scenario: "Testing pkg — snapshot helpers from the installed tarball (auditSnapshot / outlineSnapshot / tabSequenceSnapshot + redact + markFocus)"
area: Testing
type: Automated
priority: P0
status: Active
validFrom: "testing ≥ 0.1.0-beta.11 (installed from the packed tarball, not a workspace link)"
validUntil: ""
expected: "all three produce stable deterministic strings; redact masks EVERY occurrence; [focused] appears only when something is focused"
twin: D5
covers:
  - packages.@real-a11y-dev/testing
notion: "https://app.notion.com/p/3aa1c354b0b58149822cfd48d6539dbb"
---

## Steps

Install the **packed tarball** into a scratch project — not a workspace link.
Packaging faults only show from the tarball.

1. `auditSnapshot(root)` on a fixed fixture, twice in the same run
2. Same, across two separate runs
3. `outlineSnapshot(root)`
4. `tabSequenceSnapshot(root)`
5. `auditSnapshot(root, { redact: [/secret-\w+/g] })` where the string occurs
   **several** times, in a name, in text, and in an attribute
6. Focus a control, then `auditSnapshot(root, { markFocus: true })`
7. Same with nothing focused
8. `tabSequenceSnapshot` inside a stored snapshot artifact vs printed to a terminal

## Expected

- **1/2** — byte-identical every time. Non-determinism here poisons every consumer,
  because a snapshot test that flickers gets deleted
- **3** — headings in document order with levels
- **5** — **every** occurrence masked, in all three positions. One unmasked instance
  is a leak, and "masked in the name but not the text" is the realistic failure
- **6** — `[focused]` on exactly the focused node
- **7** — no `[focused]` marker at all. It must never point at a default
- **8** — unnumbered in the artifact, numbered for the terminal

## Why this exists

These strings are what users commit into their repos as expectations. Two properties
matter more than correctness of any single line:

- **Determinism** (1/2) — a snapshot that differs run to run trains people to
  `--update-snapshots` reflexively, which silently accepts real regressions.
- **Redaction completeness** (5) — partial masking is worse than none, because it
  reads as handled. Test with a value appearing in more than one position; a
  single-occurrence fixture passes a broken implementation.
