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

import { nativeAXProperty } from "./ax-node.js";
import type { LabelsOf } from "./labels.js";
import { sensitivePopupRoots } from "./sensitive-popup.js";
import {
  givesValueAway,
  indexNativeAX,
  isWithin,
  valueRegions,
  withholdRegionNames,
  type FieldStandIn,
  type NativeAXIndex,
  type RawAXNameNode,
  type ValueRegions,
} from "./value-regions.js";

/**
 * What a transport's walk of the document knows that Chromium's tree doesn't
 * say: each form control's `<label>`s (`domLabels`), where a relation
 * Chromium dropped leads from a sensitive field, and which elements mark
 * themselves chosen (`domChoiceReads`).
 *
 * @internal
 */
export interface DomReads {
  labelsOf?: LabelsOf;
  choiceTargets?: ReadonlySet<number>;
  /** What the DOM marks chosen where the tree doesn't (`domChoiceReads`). */
  chosen?: ReadonlySet<number>;
}

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
  dom: DomReads = {},
): ValueRegions {
  const roots = sensitivePopupRoots(
    index,
    fieldIds,
    dom.choiceTargets,
    dom.chosen,
  );
  const regions = valueRegions(index, roots, [], dom.labelsOf);
  // A part of `raw` in its own popup that holds no popup of its own: neither
  // another popup, nor in one, nor around one, whose choice it would read.
  const ownPart = (target: T, raw: RawAXNameNode, own: string): boolean =>
    isWithin(index.byId, target.nodeId, raw.nodeId) &&
    regions.rootOf(target) === own &&
    !roots.has(target.nodeId) &&
    !regions.containing.has(target.nodeId);
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
      const own = regions.rootOf(raw);
      if (own === null || own === raw.nodeId) {
        return regions.references(raw, property);
      }
      const relatedNodes = (
        nativeAXProperty(raw, property)?.relatedNodes ?? []
      ).filter((related) => {
        const id = related.backendDOMNodeId;
        const target =
          typeof id === "number" ? index.byBackendId.get(id) : undefined;
        return target === undefined || !ownPart(target, raw, own);
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
 * Every name and description that would say which choice a sensitive field's
 * popup holds, withheld ({@link popupChoiceRegions}); and every description
 * inside such a popup dropped, whatever it is built from (`aria-describedby`,
 * `aria-description`, `title`). One only the chosen option carries would say
 * which it is; dropped from every node alike, a description says nothing.
 *
 * @internal
 */
export function withholdPopupChoiceNames<T extends RawAXNameNode>(
  rawNodes: T[],
  index: NativeAXIndex<T>,
  fieldIds: readonly string[],
  dom: DomReads = {},
): T[] {
  const regions = popupChoiceRegions(index, fieldIds, dom);
  if (regions.roots.size === 0) return rawNodes;
  return withholdRegionNames(rawNodes, regions).map((raw) => {
    if (!raw.description || !regions.inside(raw)) return raw;
    const { description: _dropped, ...rest } = raw;
    return rest as T;
  });
}

/**
 * {@link withholdRegionNames} for a producer's sensitive fields: `fieldIds` are
 * the raw ids of the fields it classified as sensitive (or could not
 * classify). Only a field that {@link givesValueAway} withholds names around
 * it; then the choice made in such a field's popup does
 * ({@link withholdPopupChoiceNames}), in a pass of its own. `standIns` stand in for
 * such fields that have no node of their own in the tree (`fieldStandIns`),
 * and already give their value away. `dom` is what the transport's walk of
 * the document adds ({@link DomReads}).
 *
 * @internal
 */
export function withholdSensitiveFieldNames<T extends RawAXNameNode>(
  rawNodes: T[],
  fieldIds: readonly string[],
  standIns: readonly FieldStandIn[] = [],
  dom: DomReads = {},
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
    valueRegions(index, roots, standIns, dom.labelsOf),
  );
  return withholdPopupChoiceNames(named, index, fieldIds, dom);
}
