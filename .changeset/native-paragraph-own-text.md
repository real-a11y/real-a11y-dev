---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

In the native tree, a paragraph that mixes plain text with links, code or emphasis now keeps its own text. It used to show up as a bare `paragraph`.

Chromium puts a paragraph's plain text on its own text children. The native normalizer only read that text when the paragraph had no other children in the tree. So `<p>Read the <a>guide</a> and run <code>seed</code> first.</p>` printed as a bare `paragraph` with its `link` and `code` beneath it. "Read the", "and run" and "first." were lost. Now it prints `paragraph "Read the and run first."`, which is the same line the DOM producer prints. The link's and the code's text stay on their own lines, as before.

The same fix covers two ways a paragraph's name was cut short:

- **Inline formatting Chromium flattens** (`<b>`, `<small>`, a plain `<span>`) no longer truncates the name at the first run. `<p>Pure <b>bold</b> text.</p>` read `paragraph "Pure"` and now reads `paragraph "Pure bold text."`.
- **A `<br>`** reads as a space. `<p>Line one<br>Line two</p>` read `paragraph "Line one"` and now reads `paragraph "Line one Line two"`.

The same applies to any element with text of its own around its children, such as a list item that holds a link.

Only the paragraph's **own** text is used. Text inside a `<label>`, a `<div>` or a visually hidden `<span>` is not pulled up into a surrounding container, so a `main` or `nav` is never named after loose text somewhere inside it. A focusable `<header>`/`<footer>` inside an article is not named after its byline either, in line with the DOM producer.

This affects the native tree only: `real-a11y tree` and the other native CLI commands, the MCP tools, and `testing`'s native producer.

**Expect snapshot changes** in native snapshots of pages with mixed-content paragraphs or list items: those lines gain a name.
