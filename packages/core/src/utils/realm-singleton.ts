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
 * ## Two versions, and why the shape tag is checked rather than trusted
 *
 * Copies may share state only when they agree on its SHAPE. An app can easily
 * hold two engine versions at once — `testing@0.1.0-beta.15` next to
 * `inspector@0.1.0-beta.20` — and whichever loads first creates the object the
 * other one then uses.
 *
 * So each slot carries a shape tag, supplied by the caller and declared NEXT TO
 * the type it describes. On a mismatch this hands back a copy-local instance
 * instead of the shared one: the two copies stop seeing each other's nodes,
 * which is the pre-registry behaviour, and nobody reads a field or calls a
 * method the other version never had.
 *
 * That last part is the reason it is enforced rather than documented. The first
 * draft of this file left the tag in the registry key, one file away from the
 * shapes it governed, with a comment asking the next author to bump it. Adding
 * a field to `IdState` and forgetting would have meant `undefined` leaking into
 * ids, or `refs.<method> is not a function` in production — the review of this
 * PR called that out, and a comment is not a mechanism.
 *
 * The `v1` in the key is a different thing: the format of the ENVELOPE below
 * (`{shape, value}`). Bump it only if that changes, never for a release — that
 * would stop two betas in one app sharing a map, which is the bug this file
 * exists to prevent.
 */
const REGISTRY = Symbol.for("@real-a11y-dev/core.realm-singletons.v1");

/** What a slot holds: the value, plus the shape its author promised. */
interface Slot {
  shape: string;
  value: unknown;
}

type Registry = Map<string, Slot>;

function registry(): Registry {
  const holder = globalThis as typeof globalThis & {
    [REGISTRY]?: Registry;
  };
  // `??=` rather than a check-then-set: two copies evaluating this at the same
  // time on one thread cannot interleave between the read and the write.
  return (holder[REGISTRY] ??= new Map());
}

/**
 * Values this copy had to keep to itself because the realm-wide slot was
 * already filled by an incompatible version. Module scope is exactly right
 * here — one per copy of this module is the point.
 *
 * Keyed by key AND shape. Keying by `key` alone looks sufficient — a slot has
 * one shape per copy of this module, by construction — but it makes the helper
 * quietly wrong the moment that stops holding: with the realm slot taken,
 * `(k, "s@2")` and `(k, "s@3")` would both resolve to whichever asked first,
 * so the second gets an object of the wrong shape and no error says so. That
 * is the failure this whole file exists to prevent; it should not be
 * reintroduced one level down.
 */
const privateFallback = new Map<string, unknown>();

/**
 * Join the pair with a separator that cannot occur in either half.
 *
 * A space or a colon would not do: both are legal inside a key or a shape tag,
 * so `("a b", "c")` and `("a", "b c")` would produce the same string. U+241F is
 * the PRINTABLE glyph for the unit separator, chosen over a raw control byte
 * because an actual control character in source makes the whole file read as
 * binary to grep, diff and code review — a poor trade for one delimiter.
 */
function fallbackKey(key: string, shape: string): string {
  return `${key}\u241F${shape}`;
}

/**
 * Get the realm-wide value for `key`, creating it on first use.
 *
 * `create` runs at most once per realm no matter how many copies of this
 * package call it — the second caller gets the first caller's object, which is
 * the entire point.
 *
 * When another copy already filled the slot under a DIFFERENT `shape`, this
 * returns a copy-local value instead. Degraded (the two copies no longer see
 * each other's state) but safe, and it cannot be silently wrong the way reading
 * a foreign object's missing field would be.
 *
 * @param key stable identifier for the slot, unique within this package
 * @param shape bump when the stored value's shape changes; declare it beside the type
 * @param create builds the value; must be side-effect free beyond constructing it
 */
export function realmSingleton<T>(
  key: string,
  shape: string,
  create: () => T,
): T {
  const store = registry();
  const slot = store.get(key);

  if (slot) {
    if (slot.shape === shape) return slot.value as T;

    // `has`, not a truthiness or `undefined` check — the shared path already
    // has a test proving a legitimately falsy value must not be rebuilt, and
    // the fallback path deserves the same care.
    const mine = fallbackKey(key, shape);
    if (!privateFallback.has(mine)) privateFallback.set(mine, create());
    return privateFallback.get(mine) as T;
  }

  const value = create();
  store.set(key, { shape, value });
  return value;
}

/**
 * Drop every realm-wide value, so the next reader gets a fresh one.
 *
 * For tests that need isolation between cases. Production code has no reason
 * to call this: throwing away the ref map orphans every id already handed out.
 *
 * Clears the copy-local fallbacks too, or a test that exercised a shape
 * mismatch would leak its private value into the next case — but only THIS
 * copy's, since a fallback map is per-module by construction. Calling this from
 * one copy cannot reach another copy's fallbacks. Test-only, and fallbacks only
 * exist when versions disagree, so that gap has no production reach.
 *
 * @internal
 */
export function resetRealmSingletons(): void {
  registry().clear();
  privateFallback.clear();
}
