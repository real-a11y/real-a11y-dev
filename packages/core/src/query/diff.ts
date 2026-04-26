import type { SemanticNode } from "../types.js";

import { nodesOf, type QueryInput } from "./types.js";

/** A single field whose value changed between two extractions of the same node. */
export interface NodeChange {
  id: string;
  before: SemanticNode;
  after: SemanticNode;
  /** List of dot-paths that differ (e.g. `"a11y.name"`, `"a11y.states.expanded"`). */
  changes: string[];
}

/** Result of `diffTrees`. */
export interface TreeDiff {
  /** Nodes present in `after` but not in `before`. */
  added: SemanticNode[];
  /** Nodes present in `before` but not in `after`. */
  removed: SemanticNode[];
  /** Nodes present in both, with at least one observable field change. */
  changed: NodeChange[];
}

/** Fields we consider observable for a change diff. */
function collectChanges(before: SemanticNode, after: SemanticNode): string[] {
  const changes: string[] = [];

  if (before.a11y.role !== after.a11y.role) changes.push("a11y.role");
  if (before.a11y.name !== after.a11y.name) changes.push("a11y.name");
  if (before.a11y.description !== after.a11y.description) {
    changes.push("a11y.description");
  }
  if (before.dom.textContent !== after.dom.textContent) {
    changes.push("dom.textContent");
  }
  if (before.dom.isHidden !== after.dom.isHidden) changes.push("dom.isHidden");
  if (before.a11y.isExposedToAT !== after.a11y.isExposedToAT) {
    changes.push("a11y.isExposedToAT");
  }
  if (before.interaction.isFocusable !== after.interaction.isFocusable) {
    changes.push("interaction.isFocusable");
  }

  // Shallow record diffs
  const recordKeys = (
    a: Record<string, unknown>,
    b: Record<string, unknown>,
  ) => {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    const diffs: string[] = [];
    for (const k of keys) if (a[k] !== b[k]) diffs.push(k);
    return diffs;
  };
  for (const k of recordKeys(before.a11y.states, after.a11y.states)) {
    changes.push(`a11y.states.${k}`);
  }
  for (const k of recordKeys(before.a11y.properties, after.a11y.properties)) {
    changes.push(`a11y.properties.${k}`);
  }

  // Structural: child list change (different length or different ids in order)
  const sameChildren =
    before.childIds.length === after.childIds.length &&
    before.childIds.every((id, i) => id === after.childIds[i]);
  if (!sameChildren) changes.push("childIds");

  return changes;
}

/**
 * Diff two extractions of (presumably) the same DOM subtree.
 *
 * Because node ids are derived from a per-DOM-node WeakMap (`getNodeId`),
 * the same DOM node receives the same id across extractions — so id-keyed
 * comparison is a reliable proxy for "is this the same element".
 *
 * Use this to detect the effect of an action: diff the tree before and
 * after `click`, assert the expected children were added, the expected
 * states flipped, etc.
 */
export function diffTrees(before: QueryInput, after: QueryInput): TreeDiff {
  const beforeNodes = nodesOf(before);
  const afterNodes = nodesOf(after);

  const added: SemanticNode[] = [];
  const removed: SemanticNode[] = [];
  const changed: NodeChange[] = [];

  for (const [id, afterNode] of afterNodes) {
    const beforeNode = beforeNodes.get(id);
    if (!beforeNode) {
      added.push(afterNode);
      continue;
    }
    const changes = collectChanges(beforeNode, afterNode);
    if (changes.length) {
      changed.push({ id, before: beforeNode, after: afterNode, changes });
    }
  }

  for (const [id, beforeNode] of beforeNodes) {
    if (!afterNodes.has(id)) removed.push(beforeNode);
  }

  return { added, removed, changed };
}
