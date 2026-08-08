---
"@real-a11y-dev/mcp": patch
---

fix(mcp,audit): say which diff ran, and why a category came back empty

Two agent-UX nits from the beta dogfooding pass.

**Diff headers now name the operation.** `diff_findings` re-reads the live page;
`diff_checkpoints` compares two stored snapshots and touches no browser. The old
headers — `Checkpoint diff (vs. saved)` and `Checkpoint diff base → head` — did
differ, but neither said which operation ran, and the first never said _which_
checkpoint, so with several stored an output couldn't be traced back to its
input. Now:

```
Live page vs. saved checkpoint "prod": 1 new, 0 fixed, 0 changed, 12 unchanged.
Saved checkpoints: "prod" → "preview" (no re-snapshot): 0 new, 2 fixed, …
```

**An empty category explains itself.** `listByRole` returned a bare `(none)`,
which answers three different questions identically — the page has none of
these, nothing was extracted, or the category doesn't cover the role you meant.
Each has a different fix, so the empty case now says which:

```
(none — filter "image" matched 0 of 412 nodes; it looks for role img)
(none — the tree is empty, so nothing could match filter "image"; the page may
 not have loaded, or extraction failed)
```

The node count separates "this page has none" from "nothing was read". The role
list is the other half, and carries more weight than it looks: `image` looks for
exactly `img`, so a page whose graphics are `figure`s reports none — and
`landmark` includes the `form` role while the `form` filter does not, because
that one looks for the fields. Both read as a bug until the roles are visible.

Reaches `real-a11y list` and the MCP's `list_elements`, which share the function.
The signature is unchanged — still `(root, filter) => string` — so this is a
change to the text, not to the type. It now never returns an empty string, so a
caller needs no sentinel of its own.
