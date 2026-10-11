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

/**
 * The rows a read numbered (see `page-keys.ts`), for finding the row a focus
 * report names. A number names an element of one frame's document only, so
 * the rows are kept frame by frame.
 */
export interface NativePageRows {
  /** By frame (0: the top frame), each numbered row by its `pageKey`. */
  byFrame: Map<number, Map<number, string>>;
  /** By frame, the `Iframe` row showing it: where focus inside the frame
   *  lands when nothing above the focused element in the frame has a row. */
  owners: Map<number, string>;
}

/** Index the rows a read numbered: see {@link NativePageRows}. */
export function nativeRowsByPageKey(
  nodes: Map<string, NativeNode>,
): NativePageRows {
  const byFrame = new Map<number, Map<number, string>>();
  const owners = new Map<number, string>();
  for (const node of nodes.values()) {
    if (node.pageKey !== undefined) {
      const frame = node.pageFrame ?? 0;
      let rows = byFrame.get(frame);
      if (!rows) byFrame.set(frame, (rows = new Map()));
      rows.set(node.pageKey, node.id);
    }
    if (node.embedsPageFrame !== undefined) {
      owners.set(node.embedsPageFrame, node.id);
    }
  }
  return { byFrame, owners };
}

/**
 * The row the page's focus went to, from a focus report's `pageKeys` and the
 * frame it came from: the first number reported under the read this tree
 * came from (`readId`) that names a row of that frame. The focused element
 * itself comes first, then the numbered elements above it, so an element with
 * no row of its own (an unnamed wrapper the tree drops) finds the nearest one
 * that has. In a frame, when none has (focus on the frame's `<body>`, an
 * editor's), the frame's own `Iframe` row. `undefined` when the tree wasn't
 * numbered, the report has nothing for its read, or none of it names a row.
 */
export function nativeRowForPageFocus(
  pageKeys: Record<string, unknown> | undefined,
  readId: string | undefined,
  rows: NativePageRows,
  frameId: unknown = 0,
): string | undefined {
  if (readId === undefined || !pageKeys) return undefined;
  // Own property only: the read id is a UUID, but the report comes from the
  // page's renderer.
  if (!Object.prototype.hasOwnProperty.call(pageKeys, readId)) return undefined;
  const chain = pageKeys[readId];
  if (!Array.isArray(chain) || typeof frameId !== "number") return undefined;
  const inFrame = rows.byFrame.get(frameId);
  for (const key of chain) {
    if (typeof key !== "number") continue;
    const id = inFrame?.get(key);
    if (id !== undefined) return id;
  }
  return rows.owners.get(frameId);
}
