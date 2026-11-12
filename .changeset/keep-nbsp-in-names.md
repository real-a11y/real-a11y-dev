---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/testing": patch
---

**Accessible names and descriptions keep a non-breaking space (U+00A0).** Both tree producers folded it to an ASCII space, and dropped it at the start or end of a name, because they normalised with JavaScript's `\s` and `trim()`. AccName defines no collapse for text and trims only ASCII whitespace, and Chromium keeps U+00A0 (the WPT `comp_text_node` cases). So `<button>button&nbsp;label</button>` is now `button "button label"` with the U+00A0 intact, from the DOM producer (`inspector`, `react`, `storybook-addon`, `testing`, `cli tabs`, `mcp get_tab_order`) and the native producer (`cli tree`, `mcp`) alike. Tabs, line breaks and runs of ASCII spaces still fold to one space, and a blank `aria-label` is still skipped.

Name matching is unchanged: matchers and `findByRole` still fold U+00A0 to a space, so a name typed with a plain space still matches. A saved snapshot or baseline whose name carries a non-breaking space will change once, so regenerate it.
