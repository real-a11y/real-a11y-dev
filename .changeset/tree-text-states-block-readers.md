---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Read a `{…}` states block on a tree or tab line, ahead of a release that prints one: `checkbox "Subscribe" {checked=false}`. Nothing prints a block yet, so no output changes here; this makes sure every reader already understands it when something does.

- **`toMatchA11yContract`:** a received tree string with blocks matches as if they weren't there. A contract can't assert states yet, so a contract line holding a block now throws an error that names the block, instead of `cannot parse`: a contract never passes while asserting a state nothing checks.
- **`real-a11y diff` and MCP `diff_findings` / `diff_checkpoints`:** in the structural summary, a line whose only change is its block reads as one statement, `States changed: checkbox "Subscribe": checked=false → checked`, where it read as `Interactive element removed: checkbox (no accessible name)` plus the same element added. A baseline without blocks against one with them reads `(none) → checked`.
- **`--ignore-view-line`** (and `ignoreViewLine`): a pattern also matches a tree or tab line without its block, so one written before lines carried states keeps working.
