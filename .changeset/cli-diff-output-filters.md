---
"@real-a11y-dev/cli": minor
---

`diff` and `snapshot` gain `--only <findings | views>` — report a single axis: `--only findings` (the accessibility problems) or `--only views` (the tree/outline/tab-order structure). On `diff` it trims the report for focused CI comments; on `snapshot` it shapes the `--format md` report (`--md --only views` exports a page set's views; `--md --only findings` a findings report).

It's strictly an **output** filter: the exit gate is computed from the full findings either way, so `--only views` in a CI job can't silently disable enforcement — the run can exit non-zero while showing only structure, and the always-present findings summary / issue-count line explains why. In `diff --format json`, the filtered axis's arrays are omitted (`views`/`structural` under `--only findings`; `new`/`changed`/`removed` under `--only views`); the summary and per-page `structuralDiff` boolean always ship.

`snapshot --only … --format json` writes a **partial artifact**: the filtered axis is stripped from the pages and the new `meta.only` field records the capture mode (additive — full artifacts carry `meta.only: null`, schemaVersion stays 1). Partial artifacts are machine exports, not diff inputs: `diff` rejects them with exit `2` and a re-generate hint, because an empty-because-filtered axis is indistinguishable from empty-because-clean and would read as everything-new or all-removed. (Caveat: CLI versions before this release don't know `meta.only` and would diff a partial artifact without complaint — regenerate with matching versions, as with any artifact.) `sarif`/`junit`/`jsonl` are findings-shaped by construction and reject `--only`.

Designed as one enum flag rather than a `--findings-only`/`--views-only` pair: contradictory states are unrepresentable, and a config default (`"defaults": { "only": "findings" }`) is overridable from the command line by passing the other value. Under `--only findings`, view-axis modifiers (`--explain`, `--max-lines`, `--ignore-view-line`) are uniformly inert rather than errors, so an `a11y.config.json` `defaults: { "explain": true }` can coexist with an explicit filter.
