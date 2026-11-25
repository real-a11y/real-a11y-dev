/**
 * Chromium's raw AX node shape and the helpers that find, in it, the nodes a
 * name must not repeat a withheld field's value from: which referenced nodes
 * the normalized tree drops, which of them hide a field never read, and which
 * raw ids withhold names. Pure functions of the raw tree, no CDP;
 * `native-core.ts` calls them while it reads a document.
 */

import {
  cleanAXText,
  holdsUnclassifiedValue,
  isNativePasswordMask,
  nativeNodeId,
  type NativeAXIndex,
  type NativeAXNode,
  type RawAXNameNode,
} from "@real-a11y-dev/core";

/**
 * The full CDP `Accessibility.AXNode` shape, a superset of core's
 * {@link RawAXNameNode} — core only reads `role`/`name`/tree-shape fields,
 * but Chromium always sends `properties` (`expanded`, `checked`, `level`, …)
 * on the wire regardless of which subset a caller's type asks for.
 *
 * **Deliberate mirror** of `@real-a11y-dev/browser`'s `RawAXNode`
 * (`native-tree.ts`); the states and properties split is shared, core's
 * `nativeAXFacets`. The structural read stays genuinely shared through
 * `normalizeNativeAX` — this is the same "richer AX→a11y mapping" `browser`
 * layers on top of that shared base, duplicated here for the reason the file
 * header already gives for the action functions: `browser` carries
 * Playwright, no good in an MV3 worker, and core stays a pure structural
 * normalizer by design (R4) rather than growing a second enrichment path.
 *
 * @internal
 */
export interface RawAXNode extends RawAXNameNode {
  properties?: Array<{
    name: string;
    value?: {
      type?: string;
      value?: unknown;
      /** An `idref`/`idrefList` property's targets (`controls`, `owns`, …),
       *  which carry no scalar `value` at all. */
      relatedNodes?: Array<{ backendDOMNodeId?: number }>;
    };
  }>;
  description?: { value?: string };
}

/** The id `normalizeNativeAX` assigns a raw node, so a normalized node can be
 *  looked back up to its raw AX node for states/properties. Kept in lockstep
 *  with core's own `idOf` — asserted by this file's tests.
 *
 * @internal
 */
export function nativeIdOf(raw: RawAXNode): string {
  return typeof raw.backendDOMNodeId === "number"
    ? nativeNodeId(raw.backendDOMNodeId)
    : `ax-${raw.nodeId}`;
}

/** The raw nodes some node is labelled or described by that the normalized
 *  tree doesn't keep, or keeps as no more than a block of text: a `<div>` the
 *  tree keeps for the text it holds is looked into as it was when the tree
 *  dropped it, Chromium having named it nothing.
 *
 * @internal
 */
export function referencedOutsideTree(
  rawNodes: RawAXNode[],
  index: NativeAXIndex<RawAXNode>,
  kept: readonly NativeAXNode[],
  rawByNativeId: ReadonlyMap<string, RawAXNode>,
): RawAXNode[] {
  const keptIds = new Set(
    kept
      .filter((n) => {
        const raw = rawByNativeId.get(n.id);
        return !(
          raw?.role?.value === "generic" &&
          cleanAXText(String(raw.name?.value ?? "")) === ""
        );
      })
      .map((n) => n.id),
  );
  const out = new Map<string, RawAXNode>();
  for (const raw of rawNodes) {
    for (const property of raw.properties ?? []) {
      if (property.name !== "labelledby" && property.name !== "describedby") {
        continue;
      }
      for (const related of property.value?.relatedNodes ?? []) {
        const target =
          typeof related.backendDOMNodeId === "number"
            ? index.byBackendId.get(related.backendDOMNodeId)
            : undefined;
        if (target && !keptIds.has(nativeIdOf(target))) {
          out.set(target.nodeId, target);
        }
      }
    }
  }
  return [...out.values()];
}

/**
 * `target` or something under it is a node Chromium ignores, outside any
 * field already read (`read`, by normalized id). An ignored node arrives as
 * role `none` with no value, so it may be a field the tree never classified;
 * everything else under a target is either such a field, already read, or a
 * node whose role and value Chromium does send. A plain `<label>` around a
 * field holds no ignored node and needs no read of its own.
 *
 * @internal
 */
export function hidesUnreadNode(
  target: RawAXNode,
  byId: ReadonlyMap<string, RawAXNode>,
  read: ReadonlySet<string>,
): boolean {
  const stack = [target];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur.nodeId) || read.has(nativeIdOf(cur))) continue;
    seen.add(cur.nodeId);
    if (cur.ignored === true) return true;
    for (const id of cur.childIds ?? []) {
      const child = byId.get(id);
      if (child) stack.push(child);
    }
  }
  return false;
}

/**
 * The raw ids of every field whose value must stay out of other nodes'
 * names: the fields the in-page read found sensitive or could not read
 * (`withheld`), and two kinds it never got to ask about (`read` holds every
 * node it did ask about), as `@real-a11y-dev/browser` treats them:
 *
 * - a DOM-backed node that holds a value but was never read — normalization
 *   dropped it, so it was no candidate, and nothing that names another node
 *   held it. Unread is withheld.
 * - a value that is Chromium's password mask: its length is the password's.
 *
 * @internal
 */
export function nameWithholdingRoots(
  rawNodes: RawAXNode[],
  rawById: ReadonlyMap<string, RawAXNode>,
  withheld: Iterable<string>,
  read: ReadonlySet<string>,
): string[] {
  const roots = new Set<string>();
  for (const id of withheld) {
    const raw = rawById.get(id);
    if (raw) roots.add(raw.nodeId);
  }
  for (const raw of rawNodes) {
    if (
      isNativePasswordMask(raw.value?.value) ||
      holdsUnclassifiedValue(raw, read.has(nativeIdOf(raw)))
    ) {
      roots.add(raw.nodeId);
    }
  }
  return [...roots];
}
