/**
 * The `aria-owns` owner of an element, indexed once per extraction. Held apart
 * from `role-map.ts` so that file stays within its length budget.
 */
import { realmSingleton } from "../utils/realm-singleton.js";

import { safeGetAttribute, safeQuerySelectorAll } from "./clobber-safe.js";
import { idScope } from "./flat-tree.js";

/**
 * id → first `aria-owns` owner (document order) for each id scope, built on
 * first use. One index lives for one extraction: `withAriaOwnerIndex` installs
 * it and removes it again, so the page can change between extractions without
 * the index going stale.
 */
type AriaOwnerIndex = WeakMap<Document | ShadowRoot, Map<string, Element>>;

/**
 * The index of the extraction in progress, if any. It is held in the realm
 * registry rather than module scope (see `realmSingleton`), and it is only
 * ever set for the duration of one synchronous `extractDomTree` call.
 */
interface ActiveOwnerIndex {
  current: AriaOwnerIndex | null;
}

const activeOwnerIndex = (): ActiveOwnerIndex =>
  realmSingleton<ActiveOwnerIndex>(
    "role-map.aria-owner-index",
    "aria-owner-index@1",
    () => ({ current: null }),
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
  holder.current = new WeakMap();
  try {
    return fn();
  } finally {
    holder.current = previous;
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

export /** The first element whose `aria-owns` names `element`, in its id scope. */
function ariaOwner(element: Element): Element | null {
  const id = safeGetAttribute(element, "id");
  if (!id) return null;
  const scope = idScope(element);
  const index = activeOwnerIndex().current;
  if (!index) return ownersByScope(scope).get(id) ?? null;
  let owners = index.get(scope);
  if (!owners) {
    owners = ownersByScope(scope);
    index.set(scope, owners);
  }
  return owners.get(id) ?? null;
}
