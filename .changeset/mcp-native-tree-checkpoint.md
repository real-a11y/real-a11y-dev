---
"@real-a11y-dev/mcp": minor
---

feat(mcp): `checkpoint_tree` / `diff_tree` now read Chromium's native accessibility tree, the same producer the act tools target.

They were the last two tools still on the in-page DOM walk, which meant an interaction diff was written in a different vocabulary from the action that caused it — you clicked `button "Attach"` and read a diff in which that node is `textbox "Attach"`. Now there is one producer end to end.

The captured tree also moves out of the page and into the server. Previously a navigation destroyed the checkpoint and `diff_tree` could only report an error; now the checkpoint survives, and because native node ids belong to the document that issued them, `diff_tree` can tell you the page **navigated or reloaded** — naming where it started and where it ended up — instead of emitting a diff in which every node was removed and every node added.

## Breaking change

Both tools lose their `rootSelector` parameter. Chromium's accessibility tree is whole-document, so there is nothing for a selector to scope; a parameter that silently did nothing would be worse than none at all. `get_tab_order` keeps `rootSelector` — it is the one tool still built on the in-page walk, because tab _sequence_ is layout work the AX tree does not expose.

**Migration:** delete `rootSelector` from `checkpoint_tree` and `diff_tree` calls. If you were scoping a diff to a region, diff the whole document instead and read the region's part of it — the diff is per-node, so a narrower scope changed what was compared, not how the result was reported.
