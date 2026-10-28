---
"@real-a11y-dev/testing": patch
"@real-a11y-dev/inspector": patch
"@real-a11y-dev/react": patch
"@real-a11y-dev/storybook-addon": patch
"@real-a11y-dev/cli": patch
"@real-a11y-dev/mcp": patch
---

Name a paragraph, list item, code block or status message with the words inside its plain inline wrappers, the way Chromium does. Chromium gives a role-less inline element — a `<span>`, a `<b>`, a custom or unknown element — no node of its own, so its text is the line's. The DOM producer read only the element's own text nodes, and since a tree prints no `generic`, the wrapped words vanished from every printed tree:

| Markup                                                                  | Before                         | Now                                   |
| ----------------------------------------------------------------------- | ------------------------------ | ------------------------------------- |
| `<p>Drop in <b>the panel</b> now.</p>`                                  | `paragraph "Drop in now."`     | `paragraph "Drop in the panel now."`  |
| `<p>Drop in <semanticnavigator>and it appears.</semanticnavigator></p>` | `paragraph "Drop in"`          | `paragraph "Drop in and it appears."` |
| `<p><span>Only text</span></p>`                                         | `paragraph`                    | `paragraph "Only text"`               |
| `<p>A<span>B</span>C</p>`                                               | `paragraph "AC"`               | `paragraph "ABC"`                     |
| `<li>Item <span>text</span></li>`                                       | `listitem "Item"`              | `listitem "Item text"`                |
| `<pre><code><span>import</span><span> x</span></code></pre>`            | `code`                         | `code "import x"`                     |
| `<p>Line one<br>Line two</p>`                                           | `paragraph "Line oneLine two"` | `paragraph "Line one Line two"`       |

The second row is what VitePress's `v-html` makes of a literal `<SemanticNavigator />` in a `details:` string.

- **What counts as a wrapper** is what Chromium leaves out of its tree: an element with no role (or `role="none"`, or an empty or unknown one), drawn inline (`inline`, `inline-block`, `inline-flex`, `display: contents`), with nothing that could name, focus or point at it. A class, a style, a `data-*` or a `dir` keeps it a wrapper, and so does an `<a>` with no `href`.
- **Text that stays out**, because its element has a node of its own that shows it: a link, a `<code>`, `<strong>` or `<em>`, a `<label>` or `<abbr>`, a `<canvas>` or `<object>` (whose children are fallback), and a wrapper with an `id`, a `lang`, a `title`, an `aria-` attribute, a `tabindex`, an `onclick`, an explicit `role="generic"` or a box of its own (`block`, `flex`, `inline-table`, a float). A hidden wrapper adds nothing.
- **A `<div>` is unchanged.** A `generic`'s name decides whether the tree keeps it, so reading through its wrappers would add a node for every `<div><span>…</span></div>`. The wrapper still keeps its own node and name, as it does under a heading.
- **Inside an editor** nothing changes: what a user typed never names an element.
- The live tree re-names the paragraph when text inside its wrapper changes, or when the wrapper gains or loses what gives it a node of its own.

What this changes for you:

- **Snapshots and diffs:** the names of paragraphs, list items, code blocks, block quotes, definitions and live regions that hold inline wrappers change, and a syntax-highlighted code block is now named with its code. Re-record those snapshots. A DOM-produced tree now agrees with a native one on all of these.
- **Queries:** `findByRole("paragraph", { name: "Drop in the panel now." })` now finds the first row's paragraph.
- **Panels:** `inspector`, `react` and `storybook-addon` show the new names.
- **`cli` / `mcp`:** only `real-a11y tabs` and `get_tab_order` read the in-page tree, and a tab stop changes name only if it is itself a focusable paragraph, list item or code block. Everything else they print comes from Chromium's own tree, which already read these.
