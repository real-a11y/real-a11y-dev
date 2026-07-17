---
"@real-a11y-dev/serialize": minor
---

Add `serializeTreeDiff(diff, options?)` — render a `TreeDiff` from core's `diffTrees` as a deterministic, committable change list. This is the renderer that turns tree diffing from a raw primitive into something you can assert on: what **one interaction changed**, in a line each.

```
+ option "Spain"
+ option "France"
~ combobox "Country": a11y.states.expanded false → true
~ listbox "Countries": childIds 0 children → 2 children
focus: button "Country" → listbox "Countries"
```

One line per added (`+`) / removed (`-`) node and per changed field (`~`), in document order, then an optional focus transition. Nodes are labeled `role "name" (level N)` in the same vocabulary as `serializeTree` — **never a node id** (ids are a global counter; a committed snapshot containing one would flake with test order), which is also why a child-list change renders as counts (`3 children → 5 children`). A pure **reorder** — which core flags even when the count is unchanged — renders `childIds reordered (3 children)` (never a misleading identical `3 → 3`), and a membership change that also reorders the survivors is annotated `… (reordered)`, so a tab-order/menu reorder regression is visible in a committed snapshot. A field present on only one side reads `(unset)`; `redact` masks names and string values; an empty diff renders `(no changes)`.

`focusBefore`/`focusAfter` are supplied by the caller — a tree captured earlier can't answer "what was focused then" after the fact (`ExtractionResult.focusedId` records it at capture time), and core's `diffTrees` stays focus-agnostic. A `(none)` side is how a focus-management bug becomes visible: `focus: button "Save" → (none)`.
