/**
 * The names a producer's sensitive fields withhold (ADR-0001): every name and
 * description that would carry a sensitive field's value, or the choice made
 * in its popup. One entry point for the extension's native tree; the browser
 * package's `prepareRawNodes` applies the same two passes.
 *
 * Pure. No DOM, no transport.
 *
 * @internal
 */

import { nativeAncestry, nativeAXProperty } from "./ax-node.js";
import type { LabelsOf } from "./labels.js";
import { sensitivePopupRoots } from "./sensitive-popup.js";
import {
  givesValueAway,
  indexNativeAX,
  valueRegions,
  withholdRegionNames,
  type FieldStandIn,
  type NativeAXIndex,
  type RawAXNameNode,
  type ValueRegions,
} from "./value-regions.js";

/**
 * The {@link ValueRegions} of the choice made in sensitive fields' popups
 * (`sensitivePopupRoots`), for names only. A reference counts as reading the
 * choice as it does for a field, but for one: a node inside a popup, not the
 * popup itself, NAMED from its own descendants, as an option labelled by its
 * own span is, reads its own text, not which option is chosen. Its name
 * stays. Any other reference still counts, even to one option, or from the
 * popup to a caption inside it: the page may point it at the chosen one, or
 * show the choice there (a date grid captioned with the chosen month). So
 * does every description: one only the chosen option carries (a hidden
 * "selected" span inside it) would say which it is, and dropped from every
 * option alike, a description says nothing.
 *
 * @internal
 */
export function popupChoiceRegions<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  fieldIds: readonly string[],
  labelsOf?: LabelsOf,
): ValueRegions {
  const roots = sensitivePopupRoots(index, fieldIds);
  const regions = valueRegions(index, roots, [], labelsOf);
  const isWithin = (node: T, ancestor: RawAXNameNode): boolean => {
    for (const cur of nativeAncestry(node, index.byId)) {
      if (cur.nodeId === ancestor.nodeId) return true;
    }
    return false;
  };
  const popupOf = (node: RawAXNameNode): string | undefined => {
    for (const cur of nativeAncestry(node as T, index.byId)) {
      if (roots.has(cur.nodeId)) return cur.nodeId;
    }
    return undefined;
  };
  return {
    ...regions,
    references: (raw, property) => {
      // Checked first: most nodes reference nothing, and need no climb.
      if (
        property !== "labelledby" ||
        nativeAXProperty(raw, property) === undefined
      ) {
        return regions.references(raw, property);
      }
      const own = popupOf(raw);
      if (own === undefined || own === raw.nodeId) {
        return regions.references(raw, property);
      }
      const relatedNodes = (
        nativeAXProperty(raw, property)?.relatedNodes ?? []
      ).filter((related) => {
        const id = related.backendDOMNodeId;
        const target =
          typeof id === "number" ? index.byBackendId.get(id) : undefined;
        return target === undefined || !isWithin(target, raw);
      });
      if (relatedNodes.length === 0) return false;
      return regions.references(
        {
          ...raw,
          properties: [
            { name: property, value: { type: "idrefList", relatedNodes } },
          ],
        },
        property,
      );
    },
  };
}

/**
 * {@link withholdRegionNames} for a producer's sensitive fields: `fieldIds` are
 * the raw ids of the fields it classified as sensitive (or could not
 * classify). Only a field that {@link givesValueAway} withholds names around
 * it; then the choice made in such a field's popup does
 * ({@link popupChoiceRegions}), in a pass of its own. `standIns` stand in for
 * such fields that have no node of their own in the tree (`fieldStandIns`),
 * and already give their value away. `labelsOf` is the transport's walk of
 * the document's labels (`valueRegions`).
 *
 * @internal
 */
export function withholdSensitiveFieldNames<T extends RawAXNameNode>(
  rawNodes: T[],
  fieldIds: readonly string[],
  standIns: readonly FieldStandIn[] = [],
  labelsOf?: LabelsOf,
): T[] {
  const index = indexNativeAX(rawNodes);
  const roots = new Set<string>();
  for (const id of fieldIds) {
    const field = index.byId.get(id);
    if (field && givesValueAway(field, index.byId)) roots.add(id);
  }
  for (const { nodeIds } of standIns) {
    for (const id of nodeIds) if (index.byId.has(id)) roots.add(id);
  }
  const named = withholdRegionNames(
    rawNodes,
    valueRegions(index, roots, standIns, labelsOf),
  );
  return withholdRegionNames(
    named,
    popupChoiceRegions(index, fieldIds, labelsOf),
  );
}
