/** Small helpers over a native tree's flat {@link NativeNode} map. */

import type { NativeNode } from "./native-actions.js";

/**
 * A `childId -> parentId` index, derived from each node's `childIds`. A
 * {@link NativeNode} carries no parent pointer of its own, so this is the way
 * to walk up a native tree.
 */
export function nativeParentIndex(
  nodes: Map<string, NativeNode>,
): Map<string, string> {
  const parentOf = new Map<string, string>();
  for (const node of nodes.values()) {
    for (const childId of node.childIds ?? []) parentOf.set(childId, node.id);
  }
  return parentOf;
}
