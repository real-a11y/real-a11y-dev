---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Read a `{…}` states block on a tree or tab line, ahead of a release that prints one: `checkbox "Subscribe" {checked=false}`. Nothing prints a block yet; this makes sure every reader already understands it when something does.

- **`toMatchA11yContract`:** reads a block on a received tree line instead of failing with `cannot parse`; a contract line without a block matches it as before.
- **`real-a11y diff` and MCP `diff_findings` / `diff_checkpoints`:** in the structural summary, a line whose only change is its block reads as one statement, `States changed: checkbox "Subscribe": checked=false → checked`, where it read as `Interactive element removed: checkbox (no accessible name)` plus the same element added. A baseline without blocks against one with them reads `(none) → checked`.
- **`--ignore-view-line`** (and `ignoreViewLine`): a pattern also matches a tree or tab line without its block, so one written before lines carried states keeps working.
- **Two changes to today's structural summary**, with or without blocks: added or removed interactive elements, landmarks and tab stops that share a role and name make one `(×N)` statement, where lines differing only in their `(level N)` made separate statements that read the same; and removing or adding a heading several times no longer also counts the extra copies under "Other content changed".
