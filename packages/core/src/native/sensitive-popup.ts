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

import {
  isChoiceState,
  POPUP_CHOICE_ROLES,
} from "../extraction/sensitivity.js";

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

const NO_TARGETS: ReadonlySet<number> = new Set();

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

/**
 * Every choice container (`POPUP_CHOICE_ROLES`) at or above `node`. Not only
 * the nearest: a radio group or menu nested in a grid would otherwise bound
 * the popup, and the grid's chosen row outside it would show.
 */
function choiceContainersOf<T extends RawAXNameNode>(
  node: T,
  byId: ReadonlyMap<string, T>,
): T[] {
  return [...nativeAncestry(node, byId)].filter((cur) =>
    POPUP_CHOICE_ROLES.has(cur.role?.value ?? ""),
  );
}

/**
 * The choice containers `host`'s `aria-activedescendant` sits in, as Chromium
 * resolves it, or the active node itself outside any.
 */
function activeContainers<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  host: T,
): T[] {
  const active = nativeAXProperty(host, "activedescendant");
  return (active?.relatedNodes ?? []).flatMap((related) => {
    const id = related.backendDOMNodeId;
    const target =
      typeof id === "number" ? index.byBackendId.get(id) : undefined;
    if (!target) return [];
    const containers = choiceContainersOf(target, index.byId);
    return containers.length > 0 ? containers : [target];
  });
}

/**
 * Where a sensitive field's choice is made, in Chromium's tree: the roots of
 * the regions whose choice states, and the names read from them, say what the
 * field holds. For each field in `fieldIds` and each combobox around one
 * ({@link sensitiveChoiceHosts}):
 *
 * - what it controls or owns ({@link fieldRelationRoots});
 * - every choice container its `aria-activedescendant` sits in (the active
 *   option is always in the field's popup), or that node itself;
 * - a combobox around one, whole: the ARIA 1.1 wrapper holds its listbox, and
 *   Chromium relates the field inside to it on its own only for some shapes
 *   (the field its direct child, the listbox right after it);
 * - the field itself when it is a choice container (a multi-row `<select>`);
 * - the nodes for `choiceTargets`, backend ids where the DOM says a relation
 *   Chromium dropped leads (core's `domChoiceTargets`).
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
  choiceTargets: ReadonlySet<number> = NO_TARGETS,
): T[] {
  const fields = new Set(fieldIds);
  const roots = new Set<T>();
  for (const id of choiceTargets) {
    const node = index.byBackendId.get(id);
    if (node) roots.add(node);
  }
  for (const host of sensitiveChoiceHosts(index.byId, fields)) {
    for (const root of fieldRelationRoots(index, host)) roots.add(root);
    for (const root of activeContainers(index, host)) roots.add(root);
    // A combobox that holds anything is taken whole even when it is the
    // field: a transport may read an ARIA 1.1 wrapper itself as sensitive.
    const role = host.role?.value ?? "";
    const wrapper = role === "combobox" && (host.childIds?.length ?? 0) > 0;
    if (!fields.has(host.nodeId) || wrapper || POPUP_CHOICE_ROLES.has(role)) {
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
  choiceTargets: ReadonlySet<number> = NO_TARGETS,
): Set<string> {
  const roots = sensitiveChoiceRoots(index, fieldIds, choiceTargets);
  return new Set(subtreeOf(roots, index.byId).map((node) => node.nodeId));
}

/**
 * Drop from `states`, a node in `role`, the states that say which choice is
 * made (core's `isChoiceState`): what every native transport does to every
 * node `where` a sensitive field's choice is made (the browser producer's
 * region pass, the extension's `withholdInsideSensitive`), so the transports
 * can't disagree. Chromium marks a `<select>`'s chosen `option` `selected`,
 * so under a redacted `<select autocomplete="cc-exp-month">` the option rows
 * would name the month anyway; a menu popup marks its chosen item `checked`.
 *
 * A checkbox keeps `checked`: it is its own control, classified for
 * sensitivity on its own, so a checked box inside a sensitive wrapper isn't
 * that field's value, and dropping it would only make the panel's feedback
 * misread what a click does. Inside a sensitive field but not where its
 * choice is made (`where` is `"field"`: a region read fail-closed, as an
 * editor around a card input), only an option's choice states go, and any
 * node's `selected`: a toggle there is a control of its own too.
 *
 * @internal Shared with the native transports.
 */
export function dropChoiceStates(
  states: Record<string, unknown>,
  role: string,
  where: "choice" | "field" = "choice",
): void {
  if (where === "field" && role !== "option") {
    delete states["selected"];
    return;
  }
  for (const state of Object.keys(states)) {
    if (isChoiceState(state, role)) delete states[state];
  }
}

/**
 * `states`, a node in `role`, carries a state {@link dropChoiceStates}
 * drops: only such a node has a choice to withhold.
 *
 * @internal Shared with the native transports.
 */
export function carriesChoiceState(
  states: Record<string, unknown>,
  role: string,
): boolean {
  return Object.keys(states).some((state) => isChoiceState(state, role));
}

/** The raw AX states that mark a choice made: set, or `mixed`. */
const CHOICE_AX_STATES = ["selected", "checked", "pressed"];

/**
 * Some node at or under `root` is chosen: a choice state
 * ({@link dropChoiceStates}) set on it, `true` or `mixed`; or one the DOM
 * says its markup marks chosen, by backend id in `chosen` (core's
 * `domChoiceReads`): Chromium reports no `current`, and no `pressed` on an
 * option.
 */
function holdsChoice<T extends RawAXNameNode>(
  root: T,
  byId: ReadonlyMap<string, T>,
  chosen: ReadonlySet<number>,
): boolean {
  return subtreeOf([root], byId).some(
    (node) =>
      (typeof node.backendDOMNodeId === "number" &&
        chosen.has(node.backendDOMNodeId)) ||
      CHOICE_AX_STATES.some((state) => {
        if (!isChoiceState(state, node.role?.value ?? "")) return false;
        const value = nativeAXProperty(node, state)?.value;
        return value === true || value === "true" || value === "mixed";
      }),
  );
}

/**
 * Raw ids of the choice containers (`POPUP_CHOICE_ROLES`) where a sensitive
 * field's choice is made, with something chosen: those in
 * {@link sensitiveChoiceReach}. That choice is the field's value, and
 * Chromium lends it to a name built around the popup (AccName's embedded
 * control): `<label>Expiry month <input autocomplete="cc-exp-month"
 * aria-controls="lb"> <ul role="listbox" id="lb">…</ul></label>` is
 * `combobox "Expiry month 03"`. A container with nothing chosen lends
 * nothing, as an empty field doesn't (`givesValueAway`). `chosen` are the
 * backend ids the DOM says are chosen where the tree doesn't
 * ({@link holdsChoice}). Name-region roots, in both native transports.
 *
 * @internal
 */
export function sensitivePopupRoots<T extends RawAXNameNode>(
  index: NativeAXIndex<T>,
  fieldIds: Iterable<string>,
  choiceTargets: ReadonlySet<number> = NO_TARGETS,
  chosen: ReadonlySet<number> = NO_TARGETS,
): Set<string> {
  const roots = new Set<string>();
  for (const id of sensitiveChoiceReach(index, fieldIds, choiceTargets)) {
    const node = index.byId.get(id);
    if (
      node &&
      POPUP_CHOICE_ROLES.has(node.role?.value ?? "") &&
      holdsChoice(node, index.byId, chosen)
    ) {
      roots.add(id);
    }
  }
  return roots;
}
