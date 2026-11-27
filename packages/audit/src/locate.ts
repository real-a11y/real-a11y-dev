/**
 * Where a finding is: its CSS locator and, from a live element, its `href` and
 * nearest landmark. Shared by the rules in `index.ts` and `unique-names.ts`.
 */
import {
  buildCssPath,
  DOM_ELEMENT_ADAPTER,
  getElementRefs,
  insideEditor,
  type ExtractionResult,
  type SemanticNode,
} from "@real-a11y-dev/core";

import type { Finding } from "./index.js";

const LANDMARK_SELECTOR =
  "main, nav, header, footer, aside, [role=main], [role=navigation], [role=banner], [role=contentinfo], [role=complementary], [role=region]";

/**
 * Best-effort unique-ish CSS path. The traversal itself lives in core
 * ({@link buildCssPath}) because the native producer has to compute the same
 * paths from a CDP document snapshot, with no live element to walk.
 */
const cssPath = (el: Element): string => buildCssPath(el, DOM_ELEMENT_ADAPTER);

/**
 * {@link cssPath} for a tree read in strict mode: an element inside an editor
 * lends the path no `id`, which some editors derive from a heading's text. The
 * native producer's locators skip the same ids (`createLocatorIndex`).
 */
const STRICT_DOM_ADAPTER: typeof DOM_ELEMENT_ADAPTER = {
  ...DOM_ELEMENT_ADAPTER,
  id: (el) => (insideEditor(el) ? null : DOM_ELEMENT_ADAPTER.id(el)),
};

/**
 * `href` + nearest landmark, to tell otherwise-identical findings apart. In
 * strict mode no `href` from inside an editor, where a user typed or pasted it.
 */
function elementContext(el: Element, strict: boolean): string | undefined {
  const bits: string[] = [];
  const href = strict && insideEditor(el) ? null : el.getAttribute("href");
  if (href) {
    bits.push(`href="${href.length > 48 ? href.slice(0, 48) + "…" : href}"`);
  }
  const landmark = el.closest(LANDMARK_SELECTOR);
  if (landmark) {
    const role = landmark.getAttribute("role");
    bits.push(`in <${role ?? landmark.tagName.toLowerCase()}>`);
  }
  return bits.length ? bits.join(" · ") : undefined;
}

/**
 * Where a finding is, so it can be acted on without cross-referencing the tree
 * by hand. Two paths, because the two producers arrive differently: with a live
 * element (the in-page walk) the locator and its `href`/landmark context are
 * computed here; without one, the locator the producer precomputed is used and
 * there is no context to derive. `{}` only when neither is available.
 */
export function locate(
  node: SemanticNode,
  tree: ExtractionResult,
): Pick<Finding, "locator" | "context"> {
  const el = getElementRefs().get(node.id);
  if (!el) {
    // No live element: this tree came from the native producer, which ran in
    // Node over a CDP snapshot. It computed the locator during that walk, so
    // use it — otherwise every native finding would be locator-less.
    const precomputed = node.dom?.locator;
    return precomputed ? { locator: precomputed } : {};
  }
  // A strict tree's findings are strict too: the live element would otherwise
  // say what the tree was read without.
  const strict = tree.source?.redactInput === true;
  const locator = strict ? buildCssPath(el, STRICT_DOM_ADAPTER) : cssPath(el);
  const context = elementContext(el, strict);
  return context ? { locator, context } : { locator };
}
