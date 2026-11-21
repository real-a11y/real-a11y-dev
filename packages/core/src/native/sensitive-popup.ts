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
 * by, so the two can't drift ({@link sensitiveChoiceRoots}). The DOM
 * producer's counterpart is `controlledBySensitiveField`.
 *
 * @internal
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

/**
 * The nodes whose relations reach a sensitive field's popup: each field in
 * `fieldIds`, and each combobox around one. That is the ARIA 1.1 pattern, a
 * `role="combobox"` wrapper that carries `aria-controls` or `aria-owns` for
 * the field inside it, whose own relations are empty. The DOM producer's
 * counterpart is core's `isSensitiveChoiceHost`.
 *
 * @internal
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

/** Every raw node at or under `roots`, each once. */
function subtreeOf<T extends RawAXNameNode>(
  roots: readonly T[],
  byId: ReadonlyMap<string, T>,
): T[] {
  const stack = [...roots];
  const out: T[] = [];
  const seen = new Set<T>();
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (seen.has(node)) continue;
    seen.add(node);
    out.push(node);
    for (const childId of node.childIds ?? []) {
      const child = byId.get(childId);
      if (child) stack.push(child);
    }
  }
  return out;
}

/** The nearest choice container (`POPUP_CHOICE_ROLES`) at or above `node`. */
function choiceContainerOf<T extends RawAXNameNode>(
  node: T,
  byId: ReadonlyMap<string, T>,
): T | undefined {
  for (const cur of nativeAncestry(node, byId)) {
    if (POPUP_CHOICE_ROLES.has(cur.role?.value ?? "")) return cur;
  }
  return undefined;
}

/**
 * Where a sensitive field's choice is made, in Chromium's tree: the roots of
 * the regions whose choice states, and the names read from them, say what the
 * field holds. For each field in `fieldIds` and each combobox around one
 * ({@link sensitiveChoiceHosts}):
 *
 * - what it controls or owns ({@link fieldRelationRoots});
 * - the choice container its `aria-activedescendant` sits in (the active
 *   option is always in the field's popup), or that node itself;
 * - a combobox around one, whole: the ARIA 1.1 wrapper holds its listbox, and
 *   Chromium relates the field inside to it on its own only for some shapes
 *   (the field its direct child, the listbox right after it);
 * - the field itself when it is a choice container (a multi-row `<select>`).
 *
 * The one rule every native consumer derives from, so they can't drift:
 * selection ({@link sensitiveChoiceReach}) in the browser package and the
 * extension, names ({@link sensitivePopupRoots}) in both. The DOM producer's
 * counterpart is `inSensitiveChoice`.
 *
 * @internal
 */
export function sensitiveChoiceRoots<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  fieldIds: Iterable<string>,
): T[] {
  const fields = new Set(fieldIds);
  const roots = new Set<T>();
  for (const host of sensitiveChoiceHosts(index.byId, fields)) {
    for (const root of fieldRelationRoots(index, host)) roots.add(root);
    const active = nativeAXProperty(host, "activedescendant");
    for (const related of active?.relatedNodes ?? []) {
      const id = related.backendDOMNodeId;
      const target =
        typeof id === "number" ? index.byBackendId.get(id) : undefined;
      if (target) roots.add(choiceContainerOf(target, index.byId) ?? target);
    }
    if (
      !fields.has(host.nodeId) ||
      POPUP_CHOICE_ROLES.has(host.role?.value ?? "")
    ) {
      roots.add(host);
    }
  }
  return [...roots];
}

/**
 * Raw ids of every node at or under {@link sensitiveChoiceRoots}: where a
 * node's choice state says what a sensitive field holds.
 *
 * @internal
 */
export function sensitiveChoiceReach<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  fieldIds: Iterable<string>,
): Set<string> {
  const roots = sensitiveChoiceRoots(index, fieldIds);
  return new Set(subtreeOf(roots, index.byId).map((node) => node.nodeId));
}

/** Some node at or under `root` is `selected`. */
function holdsChoice<T extends RawAXNameNode>(
  root: T,
  byId: ReadonlyMap<string, T>,
): boolean {
  return subtreeOf([root], byId).some(
    (node) => nativeAXProperty(node, "selected")?.value === true,
  );
}

/**
 * Raw ids of the choice containers (`POPUP_CHOICE_ROLES`) where a sensitive
 * field's choice is made, with something chosen: those in
 * {@link sensitiveChoiceReach}. That choice is the field's value, and
 * Chromium lends it to a name built around the popup (AccName's embedded
 * control): `<label>Expiry month <input autocomplete="cc-exp-month"
 * aria-controls="lb"> <ul role="listbox" id="lb">…</ul></label>` is
 * `combobox "Expiry month 03"`. A container with nothing selected lends
 * nothing, as an empty field doesn't (`givesValueAway`). Name-region roots,
 * in both native transports.
 *
 * @internal
 */
export function sensitivePopupRoots<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  fieldIds: Iterable<string>,
): Set<string> {
  const roots = new Set<string>();
  for (const id of sensitiveChoiceReach(index, fieldIds)) {
    const node = index.byId.get(id);
    if (
      node &&
      POPUP_CHOICE_ROLES.has(node.role?.value ?? "") &&
      holdsChoice(node, index.byId)
    ) {
      roots.add(id);
    }
  }
  return roots;
}
