---
"@real-a11y-dev/mcp": minor
---

Make `producer: "native"` consistent across the MCP tools, and rename `compare_trees`.

- **`producer: "native"` now works on every tree/findings/outline/list tool** — added to `get_semantic_tree`, `get_heading_outline`, and `list_elements` (it was already on `audit_page` / `inspect_page`). One rule: every tool that projects a tree/findings/outline/element-list takes `producer`; native is whole-document (`rootSelector` must be `"body"`).
- **`get_tab_order` stays DOM-only** — a native tree carries no tab order, so the tool takes no `producer`.
- **Removed `get_native_tree`** — it's now `get_semantic_tree` with `producer: "native"` (one canonical native tree, not two subtly-different serializations).
- **Renamed `compare_trees` → `compare_producers`** — it diffs the DOM producer against the native producer (a _producer_ comparison at one instant), and the old name was easily confused with `diff_checkpoints` (a _temporal_ comparison of two checkpoints). It now compares against the same canonical native producer `get_semantic_tree { producer: "native" }` exposes, so a divergence it reports matches what you'd see there.

Breaking for callers of `get_native_tree` (use `get_semantic_tree { producer: "native" }`) or `compare_trees` (use `compare_producers`).
