---
"@real-a11y-dev/cli": minor
---

Track accessibility regressions across a PR. `real-a11y snapshot` audits a whole page set (from `a11y.config.json` or the `A11Y_PAGES` env) and writes one diffable JSON artifact — findings with stable `v1:` fingerprints plus the tree/outline/tabs views per page (or `--md` for a human report). `real-a11y diff base.json pr.json` then classifies the two as **new / changed / fixed** and exits 1 only on NEW findings at/above `--fail-on`, so pre-existing debt never blocks a PR and fixes never gate.

The diff is finding-identity-aware, not a line diff: a two-tier matcher (exact fingerprint, then greedy best-match per rule on locator/context/tag similarity) means a renumbered `:nth-of-type` locator, a re-indented subtree, or an inserted sibling reads as unchanged — only a real violation change is reported. `diff` is pure (no browser). Adds the strict, fail-closed `a11y.config.json` loader (a typo'd key is an error, so a mistake can't silently un-gate CI), `pretty` / `json` / `md` diff output, and the `diffFindings` / `diffArtifacts` / `parseSnapshotArtifact` programmatic API.
