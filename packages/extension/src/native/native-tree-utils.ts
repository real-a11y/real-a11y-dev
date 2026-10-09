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

/** A `pageKey -> row id` index over the rows a read numbered (see
 *  `page-keys.ts`), for finding the row a focus report names. */
export function nativeRowsByPageKey(
  nodes: Map<string, NativeNode>,
): Map<number, string> {
  const rows = new Map<number, string>();
  for (const node of nodes.values()) {
    if (node.pageKey !== undefined) rows.set(node.pageKey, node.id);
  }
  return rows;
}

/**
 * The row the page's focus went to, from a focus report's `pageKeys`: the
 * first number reported under the read this tree came from (`readId`) that
 * names a row. The focused element itself comes first, then the numbered
 * elements above it, so an element with no row of its own (an unnamed
 * wrapper the tree drops) finds the nearest one that has. `undefined` when
 * the tree wasn't numbered, the report has nothing for its read, or none of
 * it names a row.
 */
export function nativeRowForPageFocus(
  pageKeys: Record<string, unknown> | undefined,
  readId: string | undefined,
  rows: Map<number, string>,
): string | undefined {
  if (readId === undefined || !pageKeys) return undefined;
  // Own property only: the read id is a UUID, but the report comes from the
  // page's renderer.
  if (!Object.prototype.hasOwnProperty.call(pageKeys, readId)) return undefined;
  const chain = pageKeys[readId];
  if (!Array.isArray(chain)) return undefined;
  for (const key of chain) {
    if (typeof key !== "number") continue;
    const id = rows.get(key);
    if (id !== undefined) return id;
  }
  return undefined;
}
