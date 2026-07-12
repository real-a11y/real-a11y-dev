---
"@real-a11y-dev/cli": minor
---

Adopt the accessibility gate on a codebase that already has findings. `real-a11y snapshot --update-baseline` records today's findings in a committed `.a11y-baseline.json`; `--baseline <file>` then suppresses exactly those, and the new `--fail-on` on `snapshot` (default `never`) counts only what's left — so the build fails on genuinely **new** findings while known debt is tracked, visible, and non-blocking.

Report truth, gate policy: suppressed findings stay in every artifact and report, marked `"suppressed": true` — the baseline changes what fails the build, never what you can see. Matching reuses the same two-tier identity matcher as `diff`, so a renumbered `:nth-of-type` locator or a re-indented subtree doesn't silently un-suppress an accepted finding. A baselined finding that gets fixed produces a stale-entry warning (never a failure); `--update-baseline` prunes stale entries deterministically and carries forward the `note` field of every entry that still matches — annotate accepted debt with ticket links and they survive the rewrite. Malformed or version-mismatched baselines are hard errors (fail-closed), because a silently-ignored baseline would un-gate everything it was supposed to accept.

Also exported from the programmatic API: `loadBaseline`, `applyBaseline`, `buildBaseline`, `serializeBaseline`, and the `Baseline`/`BaselineEntry`/`BaselinePage` types.
