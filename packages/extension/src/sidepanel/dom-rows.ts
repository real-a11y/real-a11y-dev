/**
 * Display helpers for the in-page tree's rows: what a row shows of a
 * DOM-produced node. Chrome's tree's rows have theirs in `native-rows.ts`.
 */

import type { DomSemanticNode, SemanticNode } from "@real-a11y-dev/core";

/**
 * Map HTML tag names to a human-readable display role when the ARIA role
 * ("generic" / "group") doesn't convey enough semantic information.
 *
 * Elements that already have a descriptive ARIA role (heading, button, link,
 * checkbox, etc.) are NOT listed here — the ARIA role is already meaningful.
 *
 * We use the HTML tag name as the display label for elements whose ARIA role
 * is "generic" or "group" but whose tag carries real semantic meaning,
 * following the principle of showing only valid HTML names (no invented labels).
 */
const TAG_DISPLAY_OVERRIDES: Record<string, string> = {
  // Structural elements that map to "group" in ARIA
  details: "details",
  address: "address",
  hgroup: "hgroup",
  optgroup: "optgroup",
  // Structural wrapper that frames a self-contained piece of content
  iframe: "iframe",
  // Form grouping element (has its own name from <legend>)
  fieldset: "fieldset",
  // Inline/block elements that map to "generic" in ARIA
  // but carry meaningful HTML semantics worth surfacing
  pre: "pre",
  abbr: "abbr",
  kbd: "kbd",
  samp: "samp",
  q: "q",
  var: "var",
  data: "data",
  small: "small",
  b: "b",
  i: "i",
  u: "u",
  s: "s",
  figcaption: "figcaption",
  // Media / embedded content
  video: "video",
  audio: "audio",
  canvas: "canvas",
  picture: "picture",
};

/**
 * The panel only ever renders DOM-produced trees, so every node carries all
 * facets. Narrow a looked-up node to {@link DomSemanticNode} at read sites that
 * need `dom` / `interaction` / `ui` (the `nodes` Map itself stays
 * `SemanticNode`-typed so it can still be passed to core helpers).
 */
export const asDom = (
  n: SemanticNode | undefined,
): DomSemanticNode | undefined => n as DomSemanticNode | undefined;

/** Return the role label to display for a node in A11Y view */
export function getDisplayRole(node: DomSemanticNode): string {
  const override = TAG_DISPLAY_OVERRIDES[node.dom.tagName];
  if (override) return override;
  return node.a11y.role;
}

/**
 * Whether a row may print the node's own text. Never a `<textarea>`'s, in
 * either view: its text content is its markup DEFAULT, not what it holds now
 * (the value line shows that), and for a sensitive field
 * (`autocomplete="one-time-code"`) the default is the secret itself.
 */
export function showsTextContent(node: DomSemanticNode): boolean {
  return node.dom.tagName !== "textarea";
}

/**
 * Whether the A11y view may print a leaf's text preview. Not for a node with
 * an announced value (an editor, an ARIA textbox or combobox, a slider's
 * fallback text): the value line already shows what a screen reader reads,
 * and the two are computed differently (block spacing), so comparing them
 * misses and an editor's text prints twice.
 */
export function showsTextPreview(node: DomSemanticNode): boolean {
  return node.a11y.value === undefined && showsTextContent(node);
}
