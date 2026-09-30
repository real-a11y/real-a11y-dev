import { parseTabindex } from "../extraction/focusability.js";
import type { SemanticNode } from "../types.js";

import { linearize } from "./linearize.js";
import type { QueryInput } from "./types.js";

/**
 * Return the tab sequence of the tree — every focusable node in the order a
 * user would hit while pressing Tab:
 *
 *   1. `tabindex > 0` in ascending numeric order (ties broken by DOM order).
 *   2. `tabindex === 0` and naturally focusable elements, in DOM order.
 *
 * Nodes with a negative tabindex or `interaction.isFocusable === false` are
 * excluded. A disabled control is already unfocusable there. An
 * `aria-disabled` one is not, and stays a stop, as it does in Chromium.
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
    // A node with no `interaction` facet (native read-only) is not known
    // focusable, so it doesn't enter the tab sequence.
    if (!node.interaction?.isFocusable) {
      order++;
      continue;
    }
    const ti = parseTabindex(node.dom?.attributes?.tabindex);
    if (ti !== null && ti < 0) {
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
