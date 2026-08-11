import { describe, it, expect, beforeEach } from "vitest";

import { realmSingleton, resetRealmSingletons } from "./realm-singleton.js";

type IdModule = typeof import("./id-generator.js");
type RefModule = typeof import("../extraction/dom-extractor.js");

// The specifiers are STATIC literals on purpose: Vite resolves dynamic imports
// at build time and rejects a template string it cannot analyse
// ("Unknown variable dynamic import"). Two hand-written entries beat a loop
// that does not run.
//
// `?copy=N` is a loader query, not a path on disk — it is how you ask for a
// SECOND instance of a module in one realm, which is the entire subject of
// this file. TypeScript has no concept of it, hence the suppressions; the
// casts restore the real types either way.
const COPIES = [
  async () => ({
    // @ts-expect-error loader query, see above
    ids: (await import("./id-generator.js?copy=1")) as IdModule,
    // @ts-expect-error loader query, see above
    refs: (await import("../extraction/dom-extractor.js?copy=1")) as RefModule,
  }),
  async () => ({
    // @ts-expect-error loader query, see above
    ids: (await import("./id-generator.js?copy=2")) as IdModule,
    // @ts-expect-error loader query, see above
    refs: (await import("../extraction/dom-extractor.js?copy=2")) as RefModule,
  }),
];

/**
 * Load a module under a query suffix so the bundler/loader treats it as a
 * DISTINCT module instance — the same thing that happens in production when
 * two published packages each inline their own copy of the engine.
 *
 * This is the only honest way to test the property. Importing the module twice
 * normally returns the cached instance, which is precisely the situation that
 * was never broken.
 */
function loadCopy(n: 1 | 2) {
  return COPIES[n - 1]!();
}

describe("realmSingleton", () => {
  beforeEach(() => {
    resetRealmSingletons();
  });

  it("creates the value once and returns it thereafter", () => {
    let built = 0;
    const make = () => {
      built++;
      return { v: built };
    };

    const a = realmSingleton("t", make);
    const b = realmSingleton("t", make);

    expect(a).toBe(b);
    expect(built).toBe(1);
  });

  it("keeps separate keys separate", () => {
    expect(realmSingleton("a", () => ({}))).not.toBe(
      realmSingleton("b", () => ({})),
    );
  });

  it("survives a value that is legitimately falsy", () => {
    let built = 0;
    const make = () => {
      built++;
      return 0;
    };

    expect(realmSingleton("zero", make)).toBe(0);
    expect(realmSingleton("zero", make)).toBe(0);
    // A `get() ?? create()` implementation would rebuild every call here.
    expect(built).toBe(1);
  });
});

describe("two copies of the engine in one realm", () => {
  beforeEach(() => {
    resetRealmSingletons();
  });

  it("share one element ref map", async () => {
    const one = await loadCopy(1);
    const two = await loadCopy(2);

    // Guard the test itself: if the loader deduped these, the assertions below
    // would pass for the wrong reason and the regression could walk right back
    // in.
    expect(one.refs).not.toBe(two.refs);

    expect(one.refs.getElementRefs()).toBe(two.refs.getElementRefs());
  });

  it("resolves an id written by one copy through the other", async () => {
    const one = await loadCopy(1);
    const two = await loadCopy(2);

    const el = document.createElement("button");
    document.body.append(el);

    // Copy 1 extracts — this is `react`'s or the example's copy.
    one.refs.getElementRefs().set("sn-test", el);

    // Copy 2 acts — this is `dispatch()` inside `@real-a11y-dev/testing`.
    // Before the shared registry this returned undefined, and the action
    // silently did nothing: a Radix slider stayed at 50 after `decrement`.
    expect(two.refs.getElementRefs().get("sn-test")).toBe(el);
  });

  it("does not hand the same id to two different nodes", async () => {
    const one = await loadCopy(1);
    const two = await loadCopy(2);

    expect(one.ids).not.toBe(two.ids);

    const a = document.createElement("div");
    const b = document.createElement("div");

    const idA = one.ids.getNodeId(a);
    const idB = two.ids.getNodeId(b);

    // Two counters would both start at 0 and both say `sn-0`.
    expect(idA).not.toBe(idB);
  });

  it("gives one node the same id from either copy", async () => {
    const one = await loadCopy(1);
    const two = await loadCopy(2);

    const el = document.createElement("div");

    expect(two.ids.getNodeId(el)).toBe(one.ids.getNodeId(el));
  });
});
