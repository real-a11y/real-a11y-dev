---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

In the native tree, what a user typed into a plain `<div contenteditable>` no longer shows up as the name of the item around it. `<li><div contenteditable>…</div></li>` printed `listitem "<everything typed>"`, and a `<div role="note">` around an editor printed `note "<everything typed>"`. Both now print bare, as Chromium names them. A list item with ordinary text, like `<li><div>Alpha</div></li>`, still reads `listitem "Alpha"`.

Chromium reports an editor's text as its value and again as text inside it. The native normalizer already kept that text out of the name of a text field, and the CLI and MCP removed it from an editor such as `<div role="application" contenteditable>` after normalizing. But a plain `<div contenteditable>` is left out of the tree, and its text was copied into the name of the nearest item that kept it. The normalizer now never takes a name from text inside anything that carries a value, whichever node the name would land on. The step the CLI and MCP ran afterwards is gone, because the normalizer covers it. Their output for `application`, `document`, `log` and contenteditable `<p>` editors is unchanged.

This affects the native tree only: `real-a11y tree`, `audit` and the other native CLI commands, the MCP tools, and `testing`'s native producer. `NATIVE_AX_VOCABULARY_VERSION` goes to 6.

**Expect snapshot changes** on pages with a role-less rich-text editor inside a list item, note or similar container: that container loses the typed text as its name.
