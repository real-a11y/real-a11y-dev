---
"@real-a11y-dev/cli": patch
---

`snapshot` now rejects a typed `--root` instead of silently ignoring it.

`snapshot` scopes each page by that page's `urls[].rootSelector` — that's what
makes its artifact a faithful record of the config, and what keeps two snapshots
of the same route comparable. It never read `--root`, but it accepted the flag
and dropped it, exiting 0 with an artifact whose `v1:` fingerprints looked like
they came from a scope that was never applied. It now errors (exit 2) and points
at `urls[].rootSelector`, or `audit --root` for a one-off scoped run.

A project-wide `defaults.root` is unaffected: it's config aimed at `audit`, not
an instruction for this run, so `snapshot` still ignores it silently rather than
failing every run. `snapshot --help` no longer lists `--root`.
