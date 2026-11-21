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
 * What a sensitive field, or a combobox around one, reaches by relation: the
 * ids it names in `aria-controls`, by tree scope, so that every element
 * carrying one counts (a page that repeats an id, a hidden copy of a form
 * first, withholds both); and the elements its `aria-activedescendant`
 * reaches, the choice container the active one sits in.
 *
 * @internal
 */
export interface RelationReach {
  readonly elements: {
    add(element: Element): unknown;
    has(element: Element): boolean;
  };
  readonly ids: {
    get(scope: Document | ShadowRoot): Set<string> | undefined;
    set(scope: Document | ShadowRoot, ids: Set<string>): unknown;
  };
}

/**
 * What choice-withholding learns about a page once per extraction, with the
 * same lifetime as {@link AriaOwnerIndex}.
 *
 * @internal
 */
export interface ChoiceCache {
  /**
   * Each page scope seen (a document, a closed shadow root, a detached
   * subtree's top): its fields read, and its relations indexed into `reach`
   * when it holds a sensitive one.
   */
  readonly scopesSeen: WeakSet<Node>;
  /** Some scope seen in this extraction holds a sensitive field. */
  sensitiveSeen: boolean;
  /** Scopes seen whose relations wait for a sensitive field to be seen. */
  readonly unindexed: Node[];
  /**
   * The closed shadow root of each host whose root a scope seen is: page
   * script can't reach one through its host, but a read that starts inside
   * it can.
   */
  readonly closedRoots: WeakMap<Element, ShadowRoot>;
  /** What sensitive fields reach by relation ({@link RelationReach}). */
  readonly reach: RelationReach;
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
    scopesSeen: new WeakSet(),
    sensitiveSeen: false,
    unindexed: [],
    closedRoots: new WeakMap(),
    reach: { elements: new WeakSet(), ids: new WeakMap() },
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
