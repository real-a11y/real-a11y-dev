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
 *
 * **Read the limitation before trusting these.** `?copy=N` forces a second
 * instance of the module you name, and of nothing it imports: both copies below
 * import `./realm-singleton.js` WITHOUT a query, so they share one registry
 * module. That is enough to catch the regression this PR fixes — module-scope
 * state in `id-generator` / `dom-extractor` — but it does not exercise the part
 * that makes the fix work in a real bundle, where each copy of the engine
 * carries its own `realm-singleton` too. `describe("two copies of the REGISTRY
 * module")` below covers that half deliberately; without it this suite would
 * pass just as happily against a plain module-scope `new Map()`.
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

    const a = realmSingleton("t", "s@1", make);
    const b = realmSingleton("t", "s@1", make);

    expect(a).toBe(b);
    expect(built).toBe(1);
  });

  it("keeps separate keys separate", () => {
    expect(realmSingleton("a", "s@1", () => ({}))).not.toBe(
      realmSingleton("b", "s@1", () => ({})),
    );
  });

  it("survives a value that is legitimately falsy", () => {
    let built = 0;
    const make = () => {
      built++;
      return 0;
    };

    expect(realmSingleton("zero", "s@1", make)).toBe(0);
    expect(realmSingleton("zero", "s@1", make)).toBe(0);
    // A `get() ?? create()` implementation would rebuild every call here.
    expect(built).toBe(1);
  });
});

describe("shape guard", () => {
  beforeEach(() => {
    resetRealmSingletons();
  });

  // The review of this PR asked what happens when two engine VERSIONS disagree
  // about what lives in a slot. Before the guard the second one silently got
  // the first one's object and read fields that were never written.
  it("does not hand a slot to a copy that expects a different shape", () => {
    const v1 = realmSingleton("shared", "counter+ids@1", () => ({
      counter: 0,
    }));
    const v2 = realmSingleton("shared", "counter+ids@2", () => ({
      counter: 0,
      prefix: "sn",
    }));

    expect(v2).not.toBe(v1);
    // The newer copy sees the field its own version defines, rather than
    // `undefined` leaking in from the older object.
    expect(v2.prefix).toBe("sn");
  });

  it("keeps giving the SAME fallback to the mismatched copy", () => {
    realmSingleton("shared", "shape@1", () => ({ id: "first" }));

    const a = realmSingleton("shared", "shape@2", () => ({ id: "second" }));
    const b = realmSingleton("shared", "shape@2", () => ({ id: "second" }));

    // Degraded — it does not see the other version's state — but still a
    // singleton from its own point of view, so ids stay stable within it.
    expect(b).toBe(a);
  });

  it("leaves the first copy's slot untouched", () => {
    const original = realmSingleton("shared", "shape@1", () => ({ v: 1 }));
    realmSingleton("shared", "shape@2", () => ({ v: 2 }));

    expect(realmSingleton("shared", "shape@1", () => ({ v: 99 }))).toBe(
      original,
    );
  });

  it("clears the fallbacks too, or one case leaks into the next", () => {
    realmSingleton("shared", "shape@1", () => ({ v: 1 }));
    const strandedFirst = realmSingleton("shared", "shape@2", () => ({ v: 2 }));

    resetRealmSingletons();

    realmSingleton("shared", "shape@1", () => ({ v: 1 }));
    expect(realmSingleton("shared", "shape@2", () => ({ v: 2 }))).not.toBe(
      strandedFirst,
    );
  });
});

describe("two copies of the REGISTRY module", () => {
  beforeEach(() => {
    resetRealmSingletons();
  });

  // This is the half that proves the mechanism rather than the symptom.
  //
  // In a real install every published package inlines the whole engine, so
  // there are as many `realm-singleton` modules as there are packages. Nothing
  // in JS module scope can span them — only something realm-wide can, which is
  // why the store hangs off `globalThis` under a `Symbol.for` key rather than
  // living in a `const` up in this file.
  //
  // Devin caught that the engine-copy tests above could not tell the two apart:
  // they import the registry unqueried, so they share one instance and would
  // pass against a plain module-scope Map. These cases close that gap.
  it("resolves the same store from two instances of itself", async () => {
    const here = await import("./realm-singleton.js");
    // @ts-expect-error loader query — a second instance of THIS module
    const other = (await import("./realm-singleton.js?copy=2")) as typeof here;

    expect(other).not.toBe(here);

    const token = { made: "by the first instance" };
    const first = here.realmSingleton("cross-module-probe", "s@1", () => token);
    const second = other.realmSingleton("cross-module-probe", "s@1", () => ({
      made: "by the second instance",
    }));

    // A module-scope `const store = new Map()` fails right here: the second
    // instance would find an empty map and build its own object.
    expect(second).toBe(first);
    expect(second).toBe(token);
  });

  it("clears across instances, so test isolation is real", async () => {
    const here = await import("./realm-singleton.js");
    // @ts-expect-error loader query — a second instance of THIS module
    const other = (await import("./realm-singleton.js?copy=2")) as typeof here;

    const before = here.realmSingleton("clear-probe", "s@1", () => ({}));
    other.resetRealmSingletons();
    const after = here.realmSingleton("clear-probe", "s@1", () => ({}));

    expect(after).not.toBe(before);
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
