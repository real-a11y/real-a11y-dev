---
"@real-a11y-dev/serialize": minor
---

Fix indentation when hidden nodes are dropped, so the serialized tree reflects real nesting. `serializeTree` indented each line by `node.depth` — the node's depth in the _extracted_ tree — while also hiding nodes from the output. A hidden node's indent level stayed behind, so its children rendered under whatever printed line happened to precede them.

Concretely, `<main><h1>Dash</h1><div aria-label="Decor"><a href="/more">More</a></div></main>` serialized as:

```
  main
    heading "Dash" (level 1)
      link "More"
```

The link is a sibling of the heading, not its child — and `main` is indented under a root that was never printed. It now serializes as:

```
main
  heading "Dash" (level 1)
  link "More"
```

Indent is now the node's number of _printed_ ancestors. Three cases were affected, all where a node reaches the serializer and is dropped at print time rather than flattened during extraction:

- **The root.** The extractor keeps the root even when it's generic (`<body>`, or a test-mount wrapper), so dropping it left every line indented by one level. Every tree snapshot started at indent 2.
- **Named or interactive generics.** The a11y extractor deliberately keeps these; the serializer drops them, orphaning their children (the case above).
- **`mode: "dom"`.** No extraction-time flattening happens, so every wrapper is a generic the serializer drops — indentation there could be off by several levels.

Unnamed, non-interactive generics were never affected: the a11y extractor flattens those during extraction and rebases depth correctly.

**This churns committed tree snapshots.** Baselines shift left by one level (the dropped root), and any tree containing a named/interactive generic re-nests to its true shape. Re-record with your framework's update flag (`vitest -u`, `jest -u`, `playwright --update-snapshots`) or `real-a11y snapshot`, and expect a one-time diff. Heading-outline and tab-sequence snapshots are unaffected — they don't use tree depth. `includeGeneric: true` output is unchanged, since nothing is dropped.
