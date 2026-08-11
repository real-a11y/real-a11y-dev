/**
 * State that must be ONE per realm, even when several copies of this package
 * are loaded at once.
 *
 * ## Why this exists
 *
 * Two pieces of this package's state are shared by reference across the whole
 * toolkit: the node-id registry (`utils/id-generator.ts`) and the element
 * reference map (`extraction/dom-extractor.ts`). A tree extracted in one place
 * is acted on in another — `dispatch()` in `@real-a11y-dev/testing` takes a
 * node id and asks the ref map which live `Element` it means — so the writer
 * and the reader have to be looking at the same object.
 *
 * As plain module scope (`const elementRefs = new ElementRefMap()`) that holds
 * only while there is exactly one copy of this module in the process. There
 * isn't. Every published package bundles the engine rather than importing it,
 * so `testing` has its own copy, `react` has its own copy, and the extension
 * has a third. Cross the boundary and the id resolves against a map that never
 * saw the element: `dispatch` finds nothing and silently does nothing, and
 * `getNodeId` hands out `sn-0` twice for two different nodes.
 *
 * That is not hypothetical — it is what privatizing the engine surfaced. A
 * Radix slider stepped with `dispatch(slider, "decrement")` stayed at 50
 * because the extraction had populated the *other* copy's map.
 *
 * ## Why `Symbol.for`
 *
 * The symbol registry is per-REALM, not per-module: `Symbol.for(k)` returns the
 * identical symbol to every copy of this code running in the same realm, which
 * is exactly the scope the state needs. A plain global string key would work
 * too and would collide with anything else that picked the same string.
 *
 * Realm, not process, is also the right boundary: an iframe or a worker gets
 * its own registry, which matches the DOM it is describing — `Element`
 * identity does not cross those either.
 *
 * ## The version in the key
 *
 * `v1` is a compatibility tag, not this package's version. Copies only share
 * state when they agree on its SHAPE. Change what lives in the store — a field,
 * a class contract — and bump this; mismatched copies then fall back to one
 * store each, which is today's degraded behaviour rather than silent
 * corruption. Do NOT bump it for an ordinary release: that would stop
 * `0.1.0-beta.15` and `0.1.0-beta.16` sharing a map inside one app, which is
 * the exact bug this file exists to prevent.
 */
const REGISTRY = Symbol.for("@real-a11y-dev/core.realm-singletons.v1");

type Registry = Map<string, unknown>;

function registry(): Registry {
  const holder = globalThis as typeof globalThis & {
    [REGISTRY]?: Registry;
  };
  // `??=` rather than a check-then-set: two copies evaluating this at the same
  // time on one thread cannot interleave between the read and the write.
  return (holder[REGISTRY] ??= new Map());
}

/**
 * Get the realm-wide value for `key`, creating it on first use.
 *
 * `create` runs at most once per realm no matter how many copies of this
 * package call it — the second caller gets the first caller's object, which is
 * the entire point.
 *
 * @param key stable identifier for the slot, unique within this package
 * @param create builds the value; must be side-effect free beyond constructing it
 */
export function realmSingleton<T>(key: string, create: () => T): T {
  const store = registry();
  if (!store.has(key)) store.set(key, create());
  return store.get(key) as T;
}

/**
 * Drop every realm-wide value, so the next reader gets a fresh one.
 *
 * For tests that need isolation between cases. Production code has no reason
 * to call this: throwing away the ref map orphans every id already handed out.
 *
 * @internal
 */
export function resetRealmSingletons(): void {
  registry().clear();
}
