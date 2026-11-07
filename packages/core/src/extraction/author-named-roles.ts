/**
 * Roles only an author can name — by aria-label/labelledby, `title`, or a
 * host-language source (a legend, a summary) — so the last-resort direct-text
 * step of the name computation must not name them. Chromium leaves every one
 * unnamed however much loose text it holds (measured over CDP, Chromium 151):
 * `<div role="dialog">Delete this project? <button>Cancel</button></div>` is an
 * unnamed dialog, and `dialog-labeled` has to see it that way. The same goes
 * for a landmark (a named `form` becomes a landmark), an `img`, and a widget
 * whose text is its VALUE — a `<textarea>`'s contents are the user's data, not
 * its label.
 *
 * Deliberately a deny-list, so everything else keeps the fallback:
 * - `generic` — a text-bearing generic is kept in the a11y view BECAUSE it is
 *   named (`keepNode` in a11y-extractor.ts); taking that away changes the
 *   tree's shape, not just a name.
 * - The prose roles (paragraph, listitem, blockquote, term, code, time…),
 *   whose text is their content. The native producer takes their own text
 *   too (`NATIVE_AX_OWN_TEXT_ROLES`).
 * - The live regions (alert, status, log, timer, marquee). ARIA names them by
 *   author only, but their text is the announcement itself, no audit reads
 *   their name, and the native producer names a text-only one from its text
 *   as well — blanking it would blank every toast and error message.
 *
 * The native producer's counterpart is `NATIVE_AX_AUTHOR_NAMED_ROLES`, which
 * holds the same sectioning roles (article, group, feed, note, tabpanel,
 * doc-toc, graphics-document, graphics-symbol), so a text-only
 * `<div role="tabpanel">Panel text</div>` is a bare `tabpanel` in both. The
 * native table does not yet list every composite role this set does.
 */
export const AUTHOR_NAMED_ROLES: ReadonlySet<string> = new Set([
  // Windows and images
  "dialog",
  "alertdialog",
  "img",
  // Landmarks
  "banner",
  "complementary",
  "contentinfo",
  "form",
  "main",
  "navigation",
  "region",
  "search",
  // Sectioning and document structure (ARIA 1.3 sectionheader/sectionfooter
  // included — a byline is not a header's name)
  "application",
  "article",
  "document",
  "feed",
  "figure",
  "group",
  "math",
  "note",
  "sectionfooter",
  "sectionheader",
  "tabpanel",
  // DPUB-ARIA and Graphics-ARIA roles that only their author can name
  "doc-toc",
  "graphics-document",
  "graphics-symbol",
  // Composite widgets and their containers
  "grid",
  "list",
  "listbox",
  "menu",
  "menubar",
  "radiogroup",
  "rowgroup",
  "table",
  "tablist",
  "toolbar",
  "tree",
  "treegrid",
  // Widgets whose text is a value, not a label
  "combobox",
  "meter",
  "progressbar",
  "scrollbar",
  "searchbox",
  "separator",
  "slider",
  "spinbutton",
  "textbox",
]);
