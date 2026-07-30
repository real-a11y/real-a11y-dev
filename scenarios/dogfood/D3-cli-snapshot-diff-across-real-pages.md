---
id: D3
suite: dogfood
scenario: "CLI snapshot → diff across two real pages (the CI-diff-bot story, for real)"
area: CLI
type: Automated
priority: P0
status: Active
validFrom: "cli ≥ 0.1.0-beta.1. Snapshots are native-only since #258 (there is no --producer flag); native findings gained locators at browser 0.1.0-beta.12, so artifacts captured before that re-fingerprint once — re-baseline and move on"
validUntil: ""
expected: "artifacts capture real pages; identical→no changes; two different pages→ meaningful, readable structural diff"
twin: R5
covers:
  - cli.commands.snapshot
  - cli.commands.diff
notion: "https://app.notion.com/p/3aa1c354b0b581cba08cc972ced1e5de"
---

## Steps

The CI-diff-bot story, run for real against two live pages.

1. `real-a11y snapshot https://real-a11y.dev -o base.json`
2. `real-a11y diff base.json base.json`
3. `real-a11y snapshot https://real-a11y.dev/packages/cli -o other.json`
4. `real-a11y diff base.json other.json`
5. `real-a11y diff base.json other.json --explain`
6. `real-a11y diff base.json other.json --md`
7. Re-snapshot the **same** page a few minutes later; diff against `base.json`
8. Snapshot a multi-page set from a config; diff the artifacts
9. `real-a11y diff base.json other.json --fail-on never`

## Expected

- **2** — exit `0`, no changes
- **4** — a **readable** structural diff. Read it as a reviewer would: does it tell you what
  changed for a screen reader, or is it a wall?
- **5** — each classification is explained
- **6** — Markdown you'd actually paste into a PR comment
- **7** — this is the real test: an unchanged live page must diff to **nothing**. Any noise
  here — a rotating banner, a timestamp, an ad slot, a hydration race — is exactly what makes
  a real diff bot get muted
- **9** — reports, exits `0`

## Why this exists

Fixtures are stable by construction; real pages are not. Step 7 is where a diff tool earns
trust or loses it: if re-snapshotting an unchanged page produces changes, every consumer
eventually ignores the bot, and an ignored bot is strictly worse than none — it provides the
reassurance of coverage with none of the coverage.

If step 7 does produce noise, the finding isn't "the page changed" — it's _which_ volatile
thing leaked into the artifact, and whether the fingerprint should be ignoring it.

Step 4's readability is a genuine assessment, not a pass/fail on exit code. A diff nobody can
read has failed even when it's correct.
