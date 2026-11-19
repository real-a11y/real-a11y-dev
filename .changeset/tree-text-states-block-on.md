---
"@real-a11y-dev/testing": minor
"@real-a11y-dev/cli": minor
"@real-a11y-dev/mcp": minor
---

Tree and tab text print each node's states, description and announced properties in a `{…}` block, on by default. A checked and an unchecked checkbox no longer read the same:

```
checkbox "Subscribe" {checked}
checkbox "Subscribe" {checked=false}
button "Menu" {expanded=false, haspopup=menu} [focused]
textbox "Email" = "a@b.c" {required, invalid, description="We never share it"}
link "Docs" {current=page}
```

The block follows the name, the value and `(level N)`, and comes before `[focused]`. It prints an allowlist, in a fixed order, and only values that carry information: `checked` and `pressed` (set, `false` or `mixed`), `expanded` (set or `false`), `selected`, `disabled`, `readonly`, `required` and `invalid` only when set, `current` and `haspopup` as tokens, and `roledescription` and `description` JSON-quoted and run through `redact`. Nothing else prints (`focusable`, `editable`, `busy`, `modal`, …). The outline and the `~` lines of a tree diff are unchanged. See [What a line carries](https://real-a11y.dev/packages/testing/snapshots#what-a-line-carries).

- **`@real-a11y-dev/testing`:** `treeSnapshot` and `tabSequenceSnapshot` take `states` (default `true`), and so does the Playwright adapter's `treeSnapshot()`. `states: false` prints the text without blocks, byte for byte.
- **`toMatchA11yContract`:** a contract line's `{…}` block is now checked against a DOM Element's tree, where it threw before. A token the tree text never prints (`checked=true`, `disabled=false`, a key such as `Checked` or `focusable`) is an error that names the form that prints, since it could never match.
- **`@real-a11y-dev/cli` and `@real-a11y-dev/mcp`:** every tree and tab view carries the block: `real-a11y tree`, `tabs` and `inspect`, a `snapshot` artifact's tree, and the MCP `get_semantic_tree`, `get_tab_order` and `inspect_page` tools and findings checkpoints. In a structural diff summary, a state change to a renamed tab stop is reported under the tab view, where it was reported under the tree view.

### Breaking change

Every committed tree or tab snapshot holding a node with a state or a description changes once.

- **Snapshots** (`treeSnapshot`, `tabSequenceSnapshot`, `boxedTreeSnapshot`): re-record them (`vitest -u`, `jest -u`) to take the states in. To keep comparing with a baseline committed before this release, pass `states: false`.
- **Contracts:** a line that writes an unprintable token now throws. Write the printed form, such as `{checked}` for `{checked=true}`, or drop the token: a line without a block says nothing about states.
- **CLI and MCP baselines:** `real-a11y diff` against a `snapshot` artifact captured before this release, and `diff_checkpoints` against an older exported checkpoint, report each stateful line once, as `States changed: checkbox "Subscribe": (none) → checked`. Capture the baseline again with this release.
