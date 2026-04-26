import type { SemanticNode } from "../types.js";

import { linearize } from "./linearize.js";
import type { QueryInput } from "./types.js";

/**
 * Parse the tabindex from a node's DOM attributes.
 * Returns `null` if unset / unparseable.
 */
function tabindexOf(node: SemanticNode): number | null {
  const raw = node.dom.attributes?.tabindex;
  if (raw === undefined) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Return the tab sequence of the tree — every focusable node in the order a
 * user would hit while pressing Tab:
 *
 *   1. `tabindex > 0` in ascending numeric order (ties broken by DOM order).
 *   2. `tabindex === 0` and naturally focusable elements, in DOM order.
 *
 * Nodes with `tabindex === -1`, `interaction.isFocusable === false`, or
 * `a11y.states.disabled === true` are excluded.
 *
 * This is an approximation: it does not replicate the browser's sequential
 * focus navigation precisely (shadow roots, iframes, dialog focus traps), but
 * it is good enough for snapshot-based tab-order audits on a document tree.
 */
export function getTabSequence(input: QueryInput): SemanticNode[] {
  const focusable: Array<{
    node: SemanticNode;
    tabindex: number;
    order: number;
  }> = [];
  let order = 0;

  for (const node of linearize(input)) {
    if (!node.interaction.isFocusable) {
      order++;
      continue;
    }
    if (node.a11y.states?.disabled === true) {
      order++;
      continue;
    }
    const ti = tabindexOf(node);
    if (ti === -1) {
      order++;
      continue;
    }
    focusable.push({ node, tabindex: ti ?? 0, order: order++ });
  }

  const positives = focusable
    .filter((f) => f.tabindex > 0)
    .sort((a, b) =>
      a.tabindex === b.tabindex ? a.order - b.order : a.tabindex - b.tabindex,
    );
  const zeros = focusable
    .filter((f) => f.tabindex <= 0)
    .sort((a, b) => a.order - b.order);

  return [...positives, ...zeros].map((f) => f.node);
}
