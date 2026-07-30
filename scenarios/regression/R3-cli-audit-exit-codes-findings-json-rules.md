---
id: R3
suite: regression
scenario: "CLI `audit` — exit codes, findings, --format json, --rules subset"
area: CLI
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.1 (exit codes 0/1/2 and the json envelope are a frozen contract — additive changes only within 0.x)"
validUntil: ""
expected: 'clean page → exit 0 + "No accessibility issues found."; violating page → exit 1 + rule id; `--fail-on never` → exit 0'
twin: D2
covers:
  - cli.commands.audit
  - cli.exitCodes
notion: "https://app.notion.com/p/3aa1c354b0b581cfb953e550556a0018"
---

## Steps

Two fixtures: a **clean** page and one seeding a known violation (an icon-only
`<button>`, an `<img>` with no `alt`, a skipped heading level).

1. `real-a11y audit <clean-url>`
2. `real-a11y audit <violating-url>`
3. `real-a11y audit <violating-url> --fail-on warning`
4. `real-a11y audit <violating-url> --fail-on never`
5. `real-a11y audit <violating-url> --format json` — pipe through a JSON parser
6. `real-a11y audit <violating-url> --rules image-alt`
7. `real-a11y audit ./dist/index.html` — a local path, no flag ceremony
8. `real-a11y audit http://127.0.0.1:1/` — unreachable
9. `real-a11y audit <violating-url> > out.txt 2> err.txt`

## Expected

- **1** — exit `0`
- **2** — exit `1`; each finding names its rule id, severity **and** locator
- **3** — exit `1` (warnings now count)
- **4** — exit `0`, still **reporting** the findings. `never` suppresses the gate,
  not the output
- **5** — exactly **one** parseable document on stdout; `schemaVersion: 1`; each
  finding carries a stable `v1:` fingerprint
- **6** — only `image-alt` findings; the unlabeled button is not reported
- **7** — audits the file directly
- **8** — exit `2` (navigation error), not `1`. A page that failed to load is not
  a page that passed
- **9** — `out.txt` holds only the report, `err.txt` only progress. A pipe must
  never mix them

## Why this exists

The flagship gate, and the three exit codes are a **frozen contract**: `0` clean,
`1` findings at or above threshold, `2` usage/navigation error. Anything that
blurs `1` and `2` turns a broken CI job into a green one, or vice versa.

`--fail-on never` reporting-without-gating (4) is the case most likely to be
"simplified" into silence by mistake.
