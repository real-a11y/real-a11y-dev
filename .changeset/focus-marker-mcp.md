---
"@real-a11y-dev/mcp": minor
---

Surface the focused element to agents. `get_semantic_tree`, `get_tab_order`, and `inspect_page` now mark the element focused at capture time with a trailing `[focused]` (inherited from the serialize layer), so an agent can see that opening a dialog moved focus into it, or which control a keyboard user is on. Tool descriptions note the marker.

`compare_trees` explicitly opts out (`markFocus: false`): Chromium's native tree carries no focus marker, so a `[focused]` suffix on the custom side would register as a spurious custom-vs-native divergence.
