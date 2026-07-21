/**
 * Tree diff, shaped for rendering.
 *
 * `diffTrees` answers "what changed" as three lists. A tree view needs it the
 * other way round: a per-node lookup for the rows it is about to draw, plus the
 * leftovers it *cannot* draw.
 *
 * Added and changed nodes exist in the current tree, so they get a status and
 * are highlighted in place. Removed nodes do not — their elements are gone from
 * the DOM, so they have no row, no host element to highlight, and no action to
 * dispatch. They are handed back separately for the view to summarize rather
 * than faked as interactive rows.
 */

import {
  diffTrees,
  type ExtractionResult,
  type SemanticNode,
} from "@real-a11y-dev/core";

/** Status of a node that is present in the current tree. */
export type NodeDiffStatus = "added" | "changed";

export interface TreeDiffView {
  /** Per-node status, keyed by node id — only for rows that exist now. */
  status: Map<string, NodeDiffStatus>;
  /** Nodes present in the baseline and gone now; they have no row to mark. */
  removed: SemanticNode[];
}

/**
 * A present-but-empty view: a comparison is active and has found no changes
 * yet. A consumer that renders it still reserves the marker gutter (so the
 * layout is stable once a change lands) but highlights nothing. To signal that
 * the feature is *dormant* — no gutter at all — pass `undefined`, not this.
 */
export const EMPTY_DIFF_VIEW: TreeDiffView = {
  status: new Map(),
  removed: [],
};

/**
 * Diff `current` against a captured `baseline` and index the result by node id.
 *
 * Node ids are stable for elements that survive between extractions, so a node
 * kept across the interaction keeps its id and lands in `changed` (or in
 * neither, when nothing about it moved).
 */
export function buildTreeDiffView(
  baseline: ExtractionResult,
  current: ExtractionResult,
): TreeDiffView {
  const diff = diffTrees(baseline, current);
  const status = new Map<string, NodeDiffStatus>();
  for (const node of diff.added) status.set(node.id, "added");
  for (const change of diff.changed) status.set(change.id, "changed");
  return { status, removed: diff.removed };
}
