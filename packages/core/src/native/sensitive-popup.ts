/**
 * A sensitive field's popup (ADR-0001): the listbox, grid or tree an ARIA
 * combobox opens is not the field's descendant, yet the choice made there is
 * the field's value. How both native transports reach it from the field, and
 * which of its nodes lend that choice to a name. The DOM producer's
 * counterparts are in `extraction/choice-withholding`.
 *
 * Pure. No DOM, no transport.
 *
 * @internal
 */

import { POPUP_CHOICE_ROLES } from "../extraction/sensitivity.js";

import { nativeAncestry, nativeAXProperty } from "./ax-node.js";
import type { NativeAXIndex, RawAXNameNode } from "./value-regions.js";

/**
 * The relations by which a field reaches a popup that is not its descendant:
 * Chromium's resolution of `aria-controls` and `aria-owns`. Chromium leaves an
 * `aria-owns` target where it is when the owner is an `<input>` (measured,
 * Chromium 141), so owning is not always structure in the tree it sends; it
 * also reports a combobox's owned listbox as `controls`.
 */
const FIELD_RELATIONS: ReadonlySet<string> = new Set(["controls", "owns"]);

/**
 * What `field` controls or owns, by Chromium's resolution: the raw nodes its
 * `controls` and `owns` relations name. An ARIA combobox's popup listbox is
 * not the field's descendant, yet the option it marks selected is the field's
 * value. The one rule both native transports reach a sensitive field's popup
 * by, so the two can't drift: the browser package's `withholdSelection`
 * withholds everything under these ({@link fieldRelationTargets}), and the
 * extension's `controlledRegion` follows them down to the nodes its tree kept.
 * The DOM producer's counterpart is `inSensitiveChoice`.
 */
export function fieldRelationRoots<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  field: T,
): T[] {
  const roots: T[] = [];
  for (const property of field.properties ?? []) {
    if (!FIELD_RELATIONS.has(property.name)) continue;
    for (const related of property.value?.relatedNodes ?? []) {
      const target =
        typeof related.backendDOMNodeId === "number"
          ? index.byBackendId.get(related.backendDOMNodeId)
          : undefined;
      if (target && !roots.includes(target)) roots.push(target);
    }
  }
  return roots;
}

/** Every raw node at or under {@link fieldRelationRoots}. */
export function fieldRelationTargets<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  field: T,
): T[] {
  const stack = fieldRelationRoots(index, field);
  const out: T[] = [];
  const seen = new Set<T>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    out.push(node);
    for (const childId of node.childIds ?? []) {
      const child = index.byId.get(childId);
      if (child) stack.push(child);
    }
  }
  return out;
}

/**
 * The nodes whose relations reach a sensitive field's popup: each field in
 * `fieldIds`, and each combobox around one. That is the ARIA 1.1 pattern, a
 * `role="combobox"` wrapper that carries `aria-controls` or `aria-owns` for
 * the field inside it, whose own relations are empty. The DOM producer's
 * counterpart is core's `isSensitiveChoiceHost`.
 */
export function sensitiveChoiceHosts<T extends RawAXNameNode>(
  byId: ReadonlyMap<string, T>,
  fieldIds: Iterable<string>,
): T[] {
  const hosts = new Set<T>();
  for (const id of fieldIds) {
    for (const node of nativeAncestry(byId.get(id), byId)) {
      if (node.nodeId === id || node.role?.value === "combobox") {
        hosts.add(node);
      }
    }
  }
  return [...hosts];
}

/** Some node at or under `root` is `selected`. */
function holdsChoice<T extends RawAXNameNode>(
  root: T,
  byId: ReadonlyMap<string, T>,
): boolean {
  const stack = [root];
  const seen = new Set<T>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    if (nativeAXProperty(node, "selected")?.value === true) return true;
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) stack.push(child);
    }
  }
  return false;
}

/**
 * Raw ids of the choice containers (`POPUP_CHOICE_ROLES`) a sensitive field's
 * popup holds, where a choice is made: those at or under what each of
 * {@link sensitiveChoiceHosts} controls or owns. That choice is the field's value, and Chromium lends it
 * to a name built around the popup (AccName's embedded control):
 * `<label>Expiry month <input autocomplete="cc-exp-month" aria-controls="lb">
 * <ul role="listbox" id="lb">…</ul></label>` is `combobox "Expiry month 03"`.
 * A container with nothing selected lends nothing, as an empty field doesn't
 * ({@link givesValueAway}). Name-region roots, in both native transports.
 */
export function sensitivePopupRoots<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  fieldIds: Iterable<string>,
): Set<string> {
  const roots = new Set<string>();
  for (const host of sensitiveChoiceHosts(index.byId, fieldIds)) {
    for (const node of fieldRelationTargets(index, host)) {
      if (
        POPUP_CHOICE_ROLES.has(node.role?.value ?? "") &&
        holdsChoice(node, index.byId)
      ) {
        roots.add(node.nodeId);
      }
    }
  }
  return roots;
}
