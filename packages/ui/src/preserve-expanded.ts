import type { ExtractionResult } from "@real-a11y-dev/core";

/**
 * Copy `ui.expanded` from `prev` onto `next` by node id.
 *
 * Live re-extraction rebuilds nodes with a depth heuristic
 * (`expanded: depth < 2` in the DOM tree, `depth < 3` in the a11y
 * projection), so a user's expand/collapse would snap back on every
 * DomObserver flush without this. Panel hosts call it before adopting a
 * new `ExtractionResult`. Node ids are WeakMap-stable, so matching by id
 * is cheap and correct across incremental refreshes.
 */
export function preserveExpandedState(
  prev: ExtractionResult,
  next: ExtractionResult,
): void {
  for (const [id, node] of next.nodes) {
    const prevNode = prev.nodes.get(id);
    if (prevNode?.ui && node.ui) {
      node.ui.expanded = prevNode.ui.expanded;
    }
  }
}
