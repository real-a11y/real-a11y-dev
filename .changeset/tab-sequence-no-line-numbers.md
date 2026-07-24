---
"@real-a11y-dev/serialize": minor
"@real-a11y-dev/testing": minor
"@real-a11y-dev/browser": minor
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
---

Tab-order output no longer prefixes each line with a `NN.` sequence number.

`serializeTabSequence` used to render `01. link "Home"` / `02. button "Go"`. Inserting a single focusable element near the top of the page renumbered every following line, so a committed snapshot's diff churned the whole file instead of showing the one inserted stop — the exact noise these snapshots exist to avoid. Line order already conveys the sequence, so the numbers are gone: each line is now just `link "Home"` / `button "Go"`.

This flows through every surface that renders the tab-order view — `tabSequenceSnapshot()` in `@real-a11y-dev/testing`, the `tabs` view and `snapshot`/`inspect` artifacts in the CLI, the tab-order tool in the MCP server, and the browser audit's `tabOrder`.

**Breaking change.** Any committed snapshot of a tab sequence (vitest/jest `toMatchSnapshot`, an inline snapshot, or a golden file / CI artifact) will differ by the removed `NN. ` prefix on every line.

**Migration.** Re-generate the affected snapshots — `vitest -u`, `jest -u`, or re-capture the golden file. No code changes are needed; only the stored text differs.

Structural diffing is unaffected. The snapshot-diff engine behind `real-a11y diff` already stripped these sequence numbers before comparing (so an inserted stop never churned _its_ output), and it still strips them — so it reads both the new number-free output and older numbered artifacts, and a base captured by an older tool version diffs cleanly against a number-free PR.
