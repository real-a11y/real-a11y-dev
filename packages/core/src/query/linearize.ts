import type { SemanticNode } from "../types.js";

import { nodesOf, rootIdOf, type QueryInput } from "./types.js";

export interface LinearizeOptions {
  /** Include nodes with `dom.isHidden === true` (default false). */
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

  const visit = (id: string) => {
    const node = nodes.get(id);
    if (!node) return;
    const skipHidden = !includeHidden && node.dom.isHidden;
    const skipAT = !includeNotExposed && !node.a11y.isExposedToAT;
    if (!skipHidden && !skipAT) out.push(node);
    for (const childId of node.childIds) visit(childId);
  };

  visit(rootId);
  return out;
}
