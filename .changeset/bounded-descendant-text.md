---
"@real-a11y-dev/core": patch
---

Bound `getDescendantText` to a capped walk instead of materializing each element's full `textContent` subtree. Previews stop after 240 collapsed characters, avoiding O(total text × depth) string work on text-heavy pages during extraction.
