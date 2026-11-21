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

/** What sits between a DOM-producer row's two halves — see {@link textRunId}. */
const HOST_SEPARATOR = "-text-";

/**
 * The id of a DOM-producer `text` row: its parent row's id, then the id of
 * the text node the run starts at. The first half is how a reader with only
 * the id finds the element the row is text of ({@link textRunHostId}), since
 * the row has none; the second keeps the id the same from one read to the
 * next, for as long as that text node lasts. No other row's id holds the
 * separator: an element's is `sn-<n>`, with a frame prefix at most.
 */
export function textRunId(hostId: string, textNodeId: string): string {
  return `${hostId}${HOST_SEPARATOR}${textNodeId}`;
}

/** The id of the row a DOM-producer `text` row is text of, or `null` for the
 *  id of any other row. */
export function textRunHostId(id: string): string | null {
  const at = id.lastIndexOf(HOST_SEPARATOR);
  return at < 0 ? null : id.slice(0, at);
}
