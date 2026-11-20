---
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
---

The CLI and MCP server can turn the `{…}` states block off, as library callers can with `states: false`, and a snapshot artifact records which way it was captured.

- **`@real-a11y-dev/cli`:** `tree`, `tabs`, `inspect` and `snapshot` take `--no-states` (config `defaults.states: false`). It prints the text without blocks, byte for byte what these commands printed before the block existed.
- **`@real-a11y-dev/mcp`:** `get_semantic_tree`, `inspect_page`, `get_tab_order` and `checkpoint_findings` take `states` (default `true`). A findings checkpoint remembers which way it was captured, and `diff_findings` re-reads the page the same way.
- **`meta.states`:** a `snapshot` artifact, and a checkpoint exported by `export_checkpoint`, records `meta.states: true` when its tree carries blocks. An artifact without blocks leaves it out, so it reads like one captured before blocks existed. `import_checkpoint` keeps it, so `diff_findings` against an artifact from before the blocks compares without them instead of reading every stateful line as changed.
- **Mixed pairs say why they churn:** `real-a11y diff` warns on stderr when only one artifact carries blocks, and `diff_checkpoints` prints a note when only one checkpoint does. Every node with a state or a description reads as a changed tree line there; findings are unaffected. Neither appears when the output holds no tree lines (`--only findings`, or two different pages). `diff_findings` against a checkpoint without blocks notes that no state is compared.
