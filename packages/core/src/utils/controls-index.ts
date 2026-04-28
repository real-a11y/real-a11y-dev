import type { SemanticNode } from "../types.js";

/**
 * Cross-link index between disclosure triggers and the elements they control.
 *
 * Two link sources are merged here:
 *   1. `aria-controls` — the principled, explicit relationship.
 *   2. A heuristic fallback for triggers that expose `aria-haspopup` +
 *      `aria-expanded="true"` but no `aria-controls`. Many real-world apps
 *      (Google Drive, Gmail, Material UI) skip `aria-controls` and rely on
 *      DOM proximity instead.
 *
 * Both maps are keyed by tree-node id (the synthetic id used throughout the
 * tree), not the DOM `id`. The DOM-id → tree-id resolution happens once,
 * inside `buildControlsIndex`.
 *
 * `inferred` lists the trigger tree-node ids whose link came from the
 * heuristic so callers can render them with a "likely" affordance
 * (different style, hedged tooltip) instead of presenting them as ground
 * truth.
 */
export interface ControlsIndex {
  /** trigger tree-node id → tree-node ids it controls */
  forward: Map<string, string[]>;
  /** controlled tree-node id → tree-node ids of triggers pointing at it */
  reverse: Map<string, string[]>;
  /** subset of `forward` keys whose link came from the heuristic, not aria-controls */
  inferred: Set<string>;
}

/** ARIA `aria-haspopup` value → role of the popup it opens. */
const HASPOPUP_TO_ROLE: Record<string, string> = {
  true: "menu",
  menu: "menu",
  listbox: "listbox",
  tree: "tree",
  grid: "grid",
  dialog: "dialog",
};

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

  const inferred = applyHaspopupHeuristic(nodes, forward, reverse);

  return { forward, reverse, inferred };
}

/**
 * Pair triggers that have `aria-haspopup` + `aria-expanded="true"` (but no
 * `aria-controls`) with a currently-visible element of the matching role.
 *
 * Strategy:
 *   - Walk triggers in tree-traversal order (≈ DOM order).
 *   - For each, take the first unclaimed visible candidate that appears
 *     *after* the trigger. "After the trigger" matches the common pattern
 *     of menu DOM being injected later than its button (Drive, Gmail).
 *   - Mutates `forward` and `reverse` and returns the set of trigger ids
 *     that were linked heuristically.
 *
 * Limitations:
 *   - Triggers whose menu lives BEFORE them in DOM (rare) won't pair.
 *   - When two unrelated menus are visible at once and the first trigger's
 *     "real" menu happens to come second in DOM order, the wrong pairing
 *     can occur. Acceptable for typical "one menu open at a time" use.
 */
function applyHaspopupHeuristic(
  nodes: Map<string, SemanticNode>,
  forward: Map<string, string[]>,
  reverse: Map<string, string[]>,
): Set<string> {
  const inferred = new Set<string>();

  const positionOf = new Map<string, number>();
  let i = 0;
  for (const treeId of nodes.keys()) {
    positionOf.set(treeId, i++);
  }

  const triggers: Array<{ treeId: string; targetRole: string }> = [];
  for (const [treeId, node] of nodes) {
    if (forward.has(treeId)) continue; // aria-controls already linked it
    if (node.dom.attributes["aria-expanded"] !== "true") continue;
    const haspopup = node.dom.attributes["aria-haspopup"];
    if (!haspopup) continue;
    const targetRole = HASPOPUP_TO_ROLE[haspopup];
    if (!targetRole) continue;
    triggers.push({ treeId, targetRole });
  }
  if (triggers.length === 0) return inferred;

  // Candidates per role, in tree-traversal order, excluding nodes already
  // claimed as a controlled element by some explicit aria-controls link.
  const candidatesByRole = new Map<string, string[]>();
  for (const [treeId, node] of nodes) {
    if (reverse.has(treeId)) continue;
    if (node.dom.isHidden) continue;
    const arr = candidatesByRole.get(node.a11y.role) ?? [];
    arr.push(treeId);
    candidatesByRole.set(node.a11y.role, arr);
  }

  for (const { treeId: triggerId, targetRole } of triggers) {
    const candidates = candidatesByRole.get(targetRole);
    if (!candidates || candidates.length === 0) continue;
    const triggerPos = positionOf.get(triggerId)!;
    const idx = candidates.findIndex(
      (c) => (positionOf.get(c) ?? -1) > triggerPos,
    );
    if (idx === -1) continue;
    const targetTreeId = candidates.splice(idx, 1)[0];

    forward.set(triggerId, [targetTreeId]);
    const triggersForTarget = reverse.get(targetTreeId) ?? [];
    triggersForTarget.push(triggerId);
    reverse.set(targetTreeId, triggersForTarget);
    inferred.add(triggerId);
  }

  return inferred;
}
