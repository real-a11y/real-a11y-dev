/**
 * The rows `TreePanel.tsx` draws: the tree flattened to what is open and
 * matches the search, each with its place among its shown siblings.
 */

import type { DomSemanticNode, SemanticNode } from "@real-a11y-dev/core";

/** `aria-posinset`/`aria-setsize` for a row within its visible sibling group. */
export interface VisiblePosition {
  posinset: number;
  setsize: number;
}

/**
 * Flatten the tree to the rows that should render, and record each row's
 * position within its visible sibling group. Because the list is virtualized
 * (offscreen rows leave the DOM), screen readers rely on `aria-posinset`/
 * `aria-setsize` to perceive the full tree size and position — the plain
 * sibling inference of a fully-rendered `role="tree"` no longer holds.
 *
 * The panel only ever renders DOM-produced trees, so every node carries its
 * `ui` facet.
 */
export function getVisibleNodeIds(
  nodes: Map<string, SemanticNode>,
  rootId: string,
  /** The rows open, while the change marks are opening some of them;
   *  null for the nodes' own (`ui.expanded`). */
  open: ReadonlySet<string> | null,
): { ids: string[]; positions: Map<string, VisiblePosition> } {
  const ids: string[] = [];
  const positions = new Map<string, VisiblePosition>();
  const get = (id: string) => nodes.get(id) as DomSemanticNode | undefined;
  function walk(id: string, posinset: number, setsize: number) {
    const node = get(id);
    if (!node || !node.ui.matchesFilter) return;
    ids.push(id);
    positions.set(id, { posinset, setsize });
    if (open ? open.has(id) : node.ui.expanded) {
      const visibleChildren = node.childIds.filter(
        (childId) => get(childId)?.ui.matchesFilter,
      );
      visibleChildren.forEach((childId, i) => {
        walk(childId, i + 1, visibleChildren.length);
      });
    }
  }
  walk(rootId, 1, 1);
  return { ids, positions };
}
