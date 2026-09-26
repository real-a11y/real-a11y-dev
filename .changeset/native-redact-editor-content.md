---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

fix(browser): keep what a user typed into a rich-text editor out of the native tree. A `contenteditable` composer's content is its value — Chromium reports it as the editor's AX `value`, which the native producer always dropped — but Chromium also names the nodes inside the editor from that same text, and those names reached `tree`, `outline`, `list`, `audit`, `snapshot`, the `interact` diff, and MCP's `get_semantic_tree`, `diff_tree`, `audit_page`, `inspect_page` and `list_elements`, plus `attach(page, { tree: "native" })`. Typing a secret into a ProseMirror- or Lexical-style editor with `type` / `type_text` and then reading the tree printed it back as `paragraph "<secret>"`.

Below any node Chromium marks `editable` — a `contenteditable` host, a `designMode` document, including `contenteditable="false"` islands such as mention chips — the editor's text is now withheld before normalization can promote it into any name:

- the structure is kept: paragraphs, lists, links, headings, cells and figures keep their roles and nesting
- a node Chromium named from the typed text reads `[redacted]` — not empty, because an empty-named link would read as unlabeled and `audit` would report a `no-unlabeled-interactive` error that isn't there
- a text-only node such as a paragraph or list item reads unnamed, as does a container that used to take a role-less editor's text as its own name
- a name from the page's own markup — `aria-label`, `alt`, `title` — is kept, as is the editor host's own label
- a node that merely contains an editor — an `<h1>` or `<button>` around an inline-editable `<span>` — reads `[redacted]` when Chromium named it from its contents, which include the typed text; a label from outside (`<label for>`, `aria-labelledby`) is kept
- the `dom` facet drops `href`, `src`, `poster` and `id` inside the editor, and a locator there anchors on an id outside it, since an editor may derive an id from typed text

Expect a one-time change in any committed `snapshot` artifact or baseline of a page with an editor: those names now read `[redacted]`, so the next `diff` reports them as renamed. Refresh the baseline. And since every withheld node shares that name, a link inside an editor is targeted with `nth` (or through the editor itself) rather than by its text.

The DOM producer is unchanged, deliberately: it is the developer inspecting their own page and shows editor content the way it shows an `<input>`'s value. `tabs` and MCP's `get_tab_order` are built from it, so a link inside an editor still prints there under its own text.
