---
"@real-a11y-dev/cli": minor
---

`diff` and `snapshot` gain `--only <findings | views>` — report a single axis: `--only findings` (the accessibility problems) or `--only views` (the tree/outline/tab-order structure). On `diff` it trims the report for focused CI comments; on `snapshot` it shapes the `--format md` report (`--md --only views` exports a page set's views; `--md --only findings` a findings report).

It's strictly an **output** filter: the exit gate is computed from the full findings either way, so `--only views` in a CI job can't silently disable enforcement — the run can exit non-zero while showing only structure, and the always-present findings summary / issue-count line explains why. In `diff --format json`, the filtered axis's arrays are omitted (`views`/`structural` under `--only findings`; `new`/`changed`/`removed` under `--only views`); the summary and per-page `structuralDiff` boolean always ship. The `snapshot` JSON artifact is never filtered — it's the diffable input — and `sarif`/`junit`/`jsonl` are findings-shaped by construction, so `--only` with a non-`md` snapshot format fails fast (exit `2`) with a hint.

Designed as one enum flag rather than a `--findings-only`/`--views-only` pair: contradictory states are unrepresentable, and a config default (`"defaults": { "only": "findings" }`) is overridable from the command line by passing the other value. Under `--only findings`, view-axis modifiers (`--explain`, `--max-lines`, `--ignore-view-line`) are uniformly inert rather than errors, so an `a11y.config.json` `defaults: { "explain": true }` can coexist with an explicit filter.
