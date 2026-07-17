---
"@real-a11y-dev/cli": minor
---

`real-a11y diff` gains two output filters: `--findings-only` shows just the findings delta (new / changed / fixed), `--views-only` shows just the structural view diff. Useful for focused CI comments — post the findings and structure as separate comments, or trim a noisy one.

Both are strictly **output** filters: the NEW-findings exit gate is computed from the full result either way, so putting `--views-only` in a CI job can't silently disable enforcement — the run can exit `1` while showing only structure, and the always-present one-line findings summary explains why. In `--format json`, the filtered axis's arrays are omitted (`views`/`structural` under `--findings-only`; `new`/`changed`/`removed` under `--views-only`); the summary and the per-page `structuralDiff` boolean always ship.

The two flags are mutually exclusive, and `--findings-only` conflicts with `--explain` (whose statements summarize the views being hidden); both misuses fail fast with exit `2` and a hint.
