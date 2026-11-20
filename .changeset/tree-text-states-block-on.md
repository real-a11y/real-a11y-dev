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

- **`@real-a11y-dev/testing`:** `treeSnapshot` and `tabSequenceSnapshot` take `states` (default `true`), and so do the Playwright adapter's `treeSnapshot()` and `tabSequenceSnapshot()` (its options type is the new `TabSequenceSnapshotOptions`). `flow().expectTree(expected, options)` takes `treeSnapshot`'s options. `states: false` prints the text without blocks, byte for byte.
- **A `generic` that carries a state prints** in the tree view, so a `<details>` summary reads `generic "Shipping" {expanded=false}` where the DOM tree folded it away. `aria-haspopup="true"` prints as `haspopup=menu`, the popup ARIA says it means.
- **`toMatchA11yContract`:** a contract line's `{…}` block is now checked against a DOM Element's tree, where it threw before. A token the tree text never prints (`checked=true`, `disabled=false`, `current="false"`, a key such as `Checked` or `focusable`) is an error that names the form that prints, since it could never match. Against a DOM Element, `haspopup` and `roledescription` throw too: the DOM producer doesn't read them, so they could only fail, and pass under `.not`.
- **`@real-a11y-dev/cli` and `@real-a11y-dev/mcp`:** every tree and tab view carries the block: `real-a11y tree`, `tabs` and `inspect`, a `snapshot` artifact's tree, and the MCP `get_semantic_tree`, `get_tab_order` and `inspect_page` tools and findings checkpoints. In a structural diff summary, a state change to a renamed tab stop is reported under the tab view, where it was reported under the tree view. `real-a11y interact --step` takes a tree line pasted with its block and `[focused]` marker, which it ignores: a step targets role and name.
- **A sensitive list box's selection stays withheld.** In Chromium's tree, a `<select size="3" autocomplete="cc-exp-year">` holds no value of its own, so its options kept `selected` and would have printed which one was chosen. They no longer carry it, as a sensitive drop-down's options already didn't.

### Breaking change

Every committed tree or tab snapshot holding a node with a state or a description changes once.

- **Snapshots** (`treeSnapshot`, `tabSequenceSnapshot`, `boxedTreeSnapshot`): re-record them (`vitest -u`, `jest -u`) to take the states in. To keep comparing with a baseline committed before this release, pass `states: false`.
- **`flow().expectTree()`:** a hand-written expectation compares against text with blocks now. Add the blocks, or pass `{ states: false }` as its second argument.
- **Contracts:** a line that writes an unprintable token now throws, and so does a `haspopup` or `roledescription` token checked against a DOM Element. Write the printed form, such as `{checked}` for `{checked=true}`, or drop the token: a line without a block says nothing about states.
- **CLI and MCP baselines:** `real-a11y diff` against a `snapshot` artifact captured before this release, and `diff_checkpoints` against an older exported checkpoint, report each stateful line once, as `States changed: checkbox "Subscribe": (none) → checked`. Capture the baseline again with this release.
