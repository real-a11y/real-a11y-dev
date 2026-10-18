---
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
"@real-a11y-dev/testing": patch
---

In the native tree, a `<div>` of text no longer vanishes when something sits beside it. It is kept as a `generic` named from its own text, the line the DOM producer already prints for it.

Chromium names no `generic`, so it hangs a `<div>`'s text on a text run beneath it, and the native normalizer dropped both. As the only content of the element around it, the text still named that element: `<li><div>Alpha</div></li>` reads `listitem "Alpha"`, as before. Anywhere else it was lost. Each card on the APG patterns page is `<li><a><h2>Window Splitter</h2></a><div>A window splitter is a moveable separator…</div></li>`, and the description printed nowhere. It now reads `generic "A window splitter is a moveable separator…"` in the list item, after the link.

The same goes for:

- a sentence beside a button in `<main>` or in a dialog;
- a `<main>`, `<nav>` or dialog holding nothing but a `<div>` of text, which never took that text as its name;
- a second `<div>` of text in a list item, an alert or a status message, such as a job title under a name. The item was named after the first, and the second was lost. It keeps that name, and the second is kept inside it: `listitem "Alice"` holding `generic "Engineer"`. The same goes for a `<div>` beside the label, the flex item or the item's own text it is named after;
- a byline in a bare `<header>` inside a list item or an article;
- a `<div>` of text straight inside a table row, outside any cell;
- text outside every landmark.

A link inside the `<div>` nests beneath it: `<div>See the <a>docs</a> for more.</div>` reads `generic "See the for more."` with `link "docs"` under it.

No name changes. A dialog's message isn't its name, so `<div role="dialog"><div>Delete this project?</div><button>Cancel</button></div>` is still an unnamed `dialog`, and the `dialog-labeled` audit still reports it.

Text that is already said somewhere, or must not be, is left out:

- **Named from their content.** A link, a button, a heading, a table cell, an option, a tab or a `<summary>` takes its name from everything inside it, so its `<div>`s would only repeat it.
- **Labels.** A `<label>`'s text names its field, and a `<legend>`'s its fieldset.
- **Values.** Nothing inside a text field, an editor, a select, a slider, a progress bar or a date or time input becomes a node, not even the `/` between a date's parts. What was typed stays out of the tree.
- **Images and media players.** What is inside them is presentational, or the player's own controls.

This also fixes a leak of what a field holds. A `role="none"` or `"presentation"` on a disabled field takes the field's own node out of Chromium's tree, and leaves the text box inside it holding the value, which reads like any `<div>` of text. As a list item's only content it named the item, so `<li><input disabled role="none" value="…"></li>` printed the value as the item's name. The native tree now reads the document to find each field's own text box and keeps its text out, in strict mode too.

A `generic` prints only with `--include-generic`, or the MCP tools' `includeGeneric`. So the default text of `real-a11y tree`, a snapshot artifact and the MCP tree tools changes in one case: a page whose tree had a single top-level node, with a block of text outside it, now gets a `document` root around both, so every line moves one level in. The blocks are in the tree itself, though. The diff an action reports lists them like any other node: a status message in a `<div>` that changes after a click now shows in the click's diff. And the node count an empty `list` / `list_elements` answer gives (`matched 0 of N nodes`) counts them too.

This affects the native tree only: `real-a11y tree` and the other native CLI commands, the MCP tools, and `testing`'s native producer. `NATIVE_AX_VOCABULARY_VERSION` goes to 9.

**Expect snapshot changes** in native trees printed with generics, and in a native tree whose page has a block of text outside its only top-level node. A tree checkpoint exported before this release diffs against a new read with these blocks as added.
