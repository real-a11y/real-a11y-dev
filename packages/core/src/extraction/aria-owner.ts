/**
 * The `aria-owns` owner of an element, and what a sensitive field's relations
 * reach, each indexed once per extraction. Held apart from `role-map.ts` so
 * that file stays within its length budget.
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
 * What choice-withholding learns about a page once per extraction, with the
 * same lifetime as {@link AriaOwnerIndex}.
 *
 * @internal
 */
export interface ChoiceCache {
  /** Each document asked about: whether it holds any sensitive field. */
  readonly sensitivePages: WeakMap<Document, boolean>;
  /** The id scopes whose sensitive fields' relations are in `reached`. */
  readonly indexedScopes: WeakSet<Document | ShadowRoot>;
  /**
   * What a sensitive field, or a combobox around one, names in
   * `aria-controls`, and the choice container its `aria-activedescendant`
   * sits in.
   */
  readonly reached: WeakSet<Element>;
  /** Whether each element asked about is a sensitive choice host. */
  readonly hosts: WeakMap<Element, boolean>;
}

/**
 * The index of the extraction in progress, if any. It is held in the realm
 * registry rather than module scope (see `realmSingleton`), and it is only
 * ever set for the duration of one synchronous `withAriaOwnerIndex` call.
 */
interface ActiveOwnerIndex {
  current: AriaOwnerIndex | null;
  choices: ChoiceCache | null;
}

// `@4`: the store gained `sensitiveControls` (`@2`) and `choiceHosts` (`@3`),
// which became one `choices` cache. A copy of core that holds an older shape
// keeps a store of its own rather than share one it can't read.
const activeOwnerIndex = (): ActiveOwnerIndex =>
  realmSingleton<ActiveOwnerIndex>(
    "role-map.aria-owner-index",
    "aria-owner-index@4",
    () => ({ current: null, choices: null }),
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
  const previousChoices = holder.choices;
  holder.current = new WeakMap();
  holder.choices = {
    sensitivePages: new WeakMap(),
    indexedScopes: new WeakSet(),
    reached: new WeakSet(),
    hosts: new WeakMap(),
  };
  try {
    return fn();
  } finally {
    holder.current = previous;
    holder.choices = previousChoices;
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
 * The extraction's {@link ChoiceCache}, or `null` outside an extraction.
 *
 * @internal
 */
export function choiceCache(): ChoiceCache | null {
  return activeOwnerIndex().choices;
}
