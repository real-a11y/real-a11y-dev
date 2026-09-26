import type { SemanticNode } from "../types.js";

import { nodesOf, rootIdOf, type QueryInput } from "./types.js";

export interface LinearizeOptions {
  /**
   * Include nodes hidden from assistive technology as well as from sight:
   * `dom.isHidden === true` and `a11y.isExposedToAT === false`, such as a
   * `visibility: hidden` element in the DOM view. Default false.
   *
   * Visually hidden content that AT still reads — the "sr-only" pattern,
   * flagged `dom.isHidden` but exposed — is always included, because a
   * screen reader announces it.
   */
  includeHidden?: boolean;
  /**
   * Include nodes that were suppressed from the AT tree
   * (`a11y.isExposedToAT === false`). Defaults to `true` because the Map
   * sometimes contains the pre-flatten DOM nodes that aren't themselves AT-exposed
   * but do carry children. Set to `false` for strictly-AT traversal.
   */
  includeNotExposed?: boolean;
}

/**
 * Visit every node in the tree in pre-order (document order), starting from
 * the root. Respects `childIds` so that a tree that was reparented during
 * extraction (flattening, etc.) is still visited in the rendered order.
 *
 * Returns an empty array if the input is empty.
 */
export function linearize(
  input: QueryInput,
  options: LinearizeOptions = {},
): SemanticNode[] {
  const nodes = nodesOf(input);
  const rootId = rootIdOf(input);
  if (!rootId) return [];

  const { includeHidden = false, includeNotExposed = true } = options;
  const out: SemanticNode[] = [];

  const visit = (id: string, underAriaHidden: boolean) => {
    const node = nodes.get(id);
    if (!node) return;
    // `aria-hidden` hides the whole subtree from AT and no descendant can
    // override it, but the extractor records exposure per element, and the
    // DOM view keeps the subtree. Inherit it, so a node inside one is never
    // "exposed" here. (The a11y view already pruned these subtrees.)
    const ariaHidden =
      underAriaHidden || node.dom?.attributes["aria-hidden"] === "true";
    // Anything AT reaches is kept, including sr-only content: `dom.isHidden`
    // alone means "not visible", and skipping on it dropped e.g. GitHub's
    // visually hidden "Navigation Menu" heading from outlines, snapshots and
    // audits. What AT can't reach is kept only when asked for, and a node that
    // is also not visible only with `includeHidden`.
    if (
      (node.a11y.isExposedToAT && !ariaHidden) ||
      (includeNotExposed && (includeHidden || !node.dom?.isHidden))
    ) {
      out.push(node);
    }
    for (const childId of node.childIds) visit(childId, ariaHidden);
  };

  visit(rootId, false);
  return out;
}
