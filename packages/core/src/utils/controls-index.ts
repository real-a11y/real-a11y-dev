import type { SemanticNode } from "../types.js";

/**
 * Cross-link index between disclosure triggers and the elements they control
 * (the `aria-controls` relationship).
 *
 * Both maps are keyed by tree-node id (the synthetic id used throughout the
 * tree), not the DOM `id`. The DOM-id → tree-id resolution happens once,
 * inside `buildControlsIndex`.
 */
export interface ControlsIndex {
  /** trigger tree-node id → tree-node ids it controls */
  forward: Map<string, string[]>;
  /** controlled tree-node id → tree-node ids of triggers pointing at it */
  reverse: Map<string, string[]>;
}

/**
 * Walk every node, resolve `aria-controls` references against DOM ids in the
 * same tree, and return forward/reverse adjacency maps.
 *
 * Limitations:
 *   - DOM-id collisions across iframes are resolved last-write-wins. In
 *     practice `aria-controls` references stay within a single document, and
 *     cross-frame disclosure patterns are rare; revisit if a real case
 *     surfaces.
 *   - References to elements that aren't in the extracted tree (filtered out
 *     by the a11y view, hidden, etc.) are silently dropped.
 */
export function buildControlsIndex(
  nodes: Map<string, SemanticNode>,
): ControlsIndex {
  const domIdToTreeId = new Map<string, string>();
  for (const [treeId, node] of nodes) {
    const domId = node.dom.attributes["id"];
    if (domId) domIdToTreeId.set(domId, treeId);
  }

  const forward = new Map<string, string[]>();
  const reverse = new Map<string, string[]>();

  for (const [triggerTreeId, node] of nodes) {
    const raw = node.dom.attributes["aria-controls"];
    if (!raw) continue;

    const controlledTreeIds: string[] = [];
    for (const domId of raw.split(/\s+/).filter(Boolean)) {
      const targetTreeId = domIdToTreeId.get(domId);
      if (!targetTreeId) continue;
      controlledTreeIds.push(targetTreeId);

      const triggers = reverse.get(targetTreeId) ?? [];
      triggers.push(triggerTreeId);
      reverse.set(targetTreeId, triggers);
    }

    if (controlledTreeIds.length > 0) {
      forward.set(triggerTreeId, controlledTreeIds);
    }
  }

  return { forward, reverse };
}
