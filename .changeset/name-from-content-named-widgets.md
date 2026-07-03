---
"@real-a11y-dev/core": patch
---

Name-from-content now includes nested named widgets' names instead of skipping them. A heading whose content is a link — GitHub-style file headers, changelog entries, card titles — was computed as nameless; per accname-1.2 §2F.iii the link contributes its _computed accessible name_ (so a nested `aria-label` wins over its text), matching what Chrome and Firefox expose. Applies to `link`, `button`, `checkbox`, `radio`, and `switch` descendants. Structural rows keep their PR #84 behavior — a nested `treeitem`/`menuitem`/`option` is a sibling with its own announceable name, never part of its parent's label.

If you snapshot pages with link-wrapped headings, expect those names to change (from empty to the link's name) — the new value is what assistive technology actually announces.
