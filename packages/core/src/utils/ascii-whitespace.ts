/**
 * Whitespace handling for accessible names and descriptions.
 *
 * AccName 1.2 defines no collapse for text, and the only trim it defines is on
 * `aria-label`, in terms of the Infra ASCII whitespace set (tab, line feed,
 * form feed, carriage return, space). U+00A0 is not in that set: Chromium and
 * the WPT `comp_text_node` cases keep it, in the middle of a name and at either
 * end. JavaScript's `\s` and `String.prototype.trim` both match U+00A0, so a
 * name must never go through them.
 *
 * Comparison is a different layer: matchers fold U+00A0 on purpose
 * (`foldTypography` in `@real-a11y-dev/serialize`), so a name typed with a plain
 * space still matches.
 */

const ASCII_WS_RUN = /[\t\n\f\r ]+/g;
const ASCII_WS_EDGES = /^[\t\n\f\r ]+|[\t\n\f\r ]+$/g;

/** Trim ASCII whitespace from both ends; U+00A0 stays. */
export function trimAscii(text: string): string {
  return text.replace(ASCII_WS_EDGES, "");
}

/** Fold each run of ASCII whitespace to one space and trim the ends. */
export function collapseAscii(text: string): string {
  return trimAscii(text.replace(ASCII_WS_RUN, " "));
}
