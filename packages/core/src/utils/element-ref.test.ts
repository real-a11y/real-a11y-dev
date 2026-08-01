// Collection of a DOM element is not something a test can trigger — the engine
// decides when. So these tests swap in a WeakRef whose referent can be dropped
// on command, which is the only way to observe what the map does once its
// elements are gone. `collect()` is exactly what a real GC does to a WeakRef:
// deref() starts returning undefined.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { ElementRefMap } from "./element-ref.js";

class FakeWeakRef<T extends object> {
  private target: T | undefined;

  constructor(target: T) {
    this.target = target;
    created.push(this as unknown as FakeWeakRef<object>);
  }

  deref(): T | undefined {
    return this.target;
  }

  /** Stand in for the collector reclaiming the referent. */
  collect(): void {
    this.target = undefined;
  }
}

let created: FakeWeakRef<object>[] = [];

/** The map's private entry table — the thing that must not grow forever. */
function entryCount(map: ElementRefMap): number {
  return (map as unknown as { refs: Map<string, unknown> }).refs.size;
}

beforeEach(() => {
  created = [];
  vi.stubGlobal("WeakRef", FakeWeakRef);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ElementRefMap", () => {
  it("resolves a live element and forgets a collected one", () => {
    const map = new ElementRefMap();
    const el = document.createElement("div");
    map.set("sn-1", el);

    expect(map.get("sn-1")).toBe(el);

    created[0]!.collect();
    expect(map.get("sn-1")).toBeUndefined();
  });

  it("drops entries for collected elements as new ones are registered", () => {
    const map = new ElementRefMap();

    // Stand in for an SPA that churns through elements: each extraction
    // registers a fresh batch, the previous batch is detached and collected,
    // and nothing ever asks for the old ids again.
    for (let extraction = 0; extraction < 40; extraction++) {
      for (let i = 0; i < 100; i++) {
        map.set(`sn-${extraction}-${i}`, document.createElement("div"));
      }
      for (const ref of created) ref.collect();
    }

    // 4000 elements have come and gone; at most one batch is still live, so a
    // map that evicts stays in that neighbourhood rather than keeping every id
    // it has ever seen.
    expect(entryCount(map)).toBeLessThan(1000);
  });

  it("keeps every live element while pruning around them", () => {
    const map = new ElementRefMap();
    const live: Element[] = [];

    for (let i = 0; i < 500; i++) {
      const el = document.createElement("div");
      live.push(el);
      map.set(`live-${i}`, el);
    }

    // Interleave churn that dies immediately.
    for (let i = 0; i < 2000; i++) {
      const doomed = document.createElement("span");
      map.set(`dead-${i}`, doomed);
      created[created.length - 1]!.collect();
    }

    for (let i = 0; i < 500; i++) {
      expect(map.get(`live-${i}`)).toBe(live[i]);
    }
  });

  it("re-registering the same id under a new element does not grow the map", () => {
    const map = new ElementRefMap();

    for (let i = 0; i < 1000; i++) {
      map.set("sn-1", document.createElement("div"));
    }

    expect(entryCount(map)).toBe(1);
  });
});
