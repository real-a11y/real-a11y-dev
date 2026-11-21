/**
 * The role of a row that holds one run of its parent's own text, where the
 * parent mixes text with children that have a node of their own:
 *
 *     paragraph
 *       text "You accept our"
 *       link "terms"
 *       text "."
 *
 * Both producers print it (`splitTextRuns` in extraction/a11y-extractor.ts,
 * `normalizeNativeAX` in native/ax-normalize.ts), so the two trees read alike.
 * It is not an ARIA role: Chromium's name for the same node is `StaticText`.
 * A row has no element of its own, takes no action, and holds no children.
 */
export const TEXT_RUN_ROLE = "text";
