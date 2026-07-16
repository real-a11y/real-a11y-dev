---
"@real-a11y-dev/cli": minor
---

Make `diff` focus-aware. Now that serialized snapshots mark the focused element with `[focused]` (see `@real-a11y-dev/serialize`), the `diff` command:

- **Excludes the marker from the structural diff.** Focus isn't structure, so a pure focus move (same elements, only the focused one differs) no longer shows as phantom add/remove churn in the multiset views or the `--explain` statements.
- **Reports the transition under `--explain`** as a `Focused element changed: <from> → <to>` statement (or "focus now starts on…" / "focus no longer starts anywhere…" when it appears or vanishes). On a page where only focus moved, that one statement is the entire structural summary.

The literal unified diff still shows the `[focused]` line change, so the raw view stays faithful.

Note: when comparing a base snapshot captured with an older CLI (no marker) against a PR snapshot from this version, an autofocused page shows a one-line focus change. Regenerate both sides after upgrading, as with any baseline.
