/**
 * The `aria-owns` owner of an element, and whether a sensitive field names it
 * in `aria-controls`, each indexed once per extraction. Held apart from
 * `role-map.ts` so that file stays within its length budget.
 */
import { realmSingleton } from "../utils/realm-singleton.js";

import { safeGetAttribute, safeQuerySelectorAll } from "./clobber-safe.js";
import { idScope } from "./flat-tree.js";
import { isSensitiveChoiceHost } from "./sensitivity.js";

/**
 * id → first `aria-owns` owner (document order) for each id scope, built on
 * first use. One index lives for one extraction: `withAriaOwnerIndex` installs
 * it and removes it again, so the page can change between extractions without
 * the index going stale.
 */
type AriaOwnerIndex = WeakMap<Document | ShadowRoot, Map<string, Element>>;

/**
 * The ids a sensitive field names in `aria-controls`, for each id scope, built
 * on first use with the same lifetime as {@link AriaOwnerIndex}.
 */
type SensitiveControlsIndex = WeakMap<Document | ShadowRoot, Set<string>>;

/**
 * The index of the extraction in progress, if any. It is held in the realm
 * registry rather than module scope (see `realmSingleton`), and it is only
 * ever set for the duration of one synchronous `extractDomTree` call.
 */
interface ActiveOwnerIndex {
  current: AriaOwnerIndex | null;
  sensitiveControls: SensitiveControlsIndex | null;
}

// `@2`: the store gained `sensitiveControls`. A copy of core that still holds
// the `@1` shape keeps a store of its own rather than share one it can't read.
const activeOwnerIndex = (): ActiveOwnerIndex =>
  realmSingleton<ActiveOwnerIndex>(
    "role-map.aria-owner-index",
    "aria-owner-index@2",
    () => ({ current: null, sensitiveControls: null }),
  );

/**
 * Run `fn` with one `aria-owns` index shared by every role lookup inside it, so
 * a page of orphaned items scans its owners once per id scope instead of once
 * per orphan per lookup. Outside it, `ariaOwner` scans per call, as before.
 *
 * @internal
 */
export function withAriaOwnerIndex<T>(fn: () => T): T {
  const holder = activeOwnerIndex();
  const previous = holder.current;
  const previousControls = holder.sensitiveControls;
  holder.current = new WeakMap();
  holder.sensitiveControls = new WeakMap();
  try {
    return fn();
  } finally {
    holder.current = previous;
    holder.sensitiveControls = previousControls;
  }
}

function ownersByScope(scope: Document | ShadowRoot): Map<string, Element> {
  const owners = new Map<string, Element>();
  // Document order, and the first owner of an id wins, as the per-orphan scan
  // it replaces returned the first match.
  for (const owner of safeQuerySelectorAll(scope, "[aria-owns]")) {
    const owns = safeGetAttribute(owner, "aria-owns") ?? "";
    for (const id of owns.trim().split(/\s+/)) {
      if (id && !owners.has(id)) owners.set(id, owner);
    }
  }
  return owners;
}

/**
 * The first element whose `aria-owns` names `element`, in its id scope.
 *
 * @internal
 */
export function ariaOwner(element: Element): Element | null {
  const id = safeGetAttribute(element, "id");
  if (!id) return null;
  const scope = idScope(element);
  const index = activeOwnerIndex().current;
  if (!index) {
    // No extraction in progress: one lookup, so keep the early exit.
    for (const owner of safeQuerySelectorAll(scope, "[aria-owns]")) {
      const owns = safeGetAttribute(owner, "aria-owns") ?? "";
      if (owns.trim().split(/\s+/).includes(id)) return owner;
    }
    return null;
  }
  let owners = index.get(scope);
  if (!owners) {
    owners = ownersByScope(scope);
    index.set(scope, owners);
  }
  return owners.get(id) ?? null;
}

/**
 * The ids that a sensitive field, or an ARIA 1.1 combobox around one
 * ({@link isSensitiveChoiceHost}), names in `aria-controls` in `scope`.
 */
function sensitiveControlTargets(scope: Document | ShadowRoot): Set<string> {
  const ids = new Set<string>();
  for (const field of safeQuerySelectorAll(scope, "[aria-controls]")) {
    if (!isSensitiveChoiceHost(field)) continue;
    const controls = safeGetAttribute(field, "aria-controls") ?? "";
    for (const id of controls.trim().split(/\s+/)) if (id) ids.add(id);
  }
  return ids;
}

/**
 * True when a sensitive field, or an ARIA 1.1 combobox around one, names
 * `element` in its `aria-controls`, in its id scope: an ARIA combobox's popup
 * listbox, which is not the field's descendant, but whose selected option is
 * the field's value.
 *
 * @internal
 */
export function controlledBySensitiveField(element: Element): boolean {
  const id = safeGetAttribute(element, "id");
  if (!id) return false;
  const scope = idScope(element);
  const index = activeOwnerIndex().sensitiveControls;
  if (!index) return sensitiveControlTargets(scope).has(id);
  let ids = index.get(scope);
  if (!ids) {
    ids = sensitiveControlTargets(scope);
    index.set(scope, ids);
  }
  return ids.has(id);
}
