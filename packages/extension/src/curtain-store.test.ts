import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

/** Let the store's writes, which wait for hydration, reach storage. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * A store whose `storage.session.get` doesn't answer until `release` is
 * called: the boot window of a revived worker.
 */
async function storeMidHydration(session: Record<string, unknown>) {
  const store: Record<string, unknown> = { ...session };
  let release!: () => void;
  const answered = new Promise<void>((resolve) => {
    release = resolve;
  });
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      session: {
        get: (key: string) => answered.then(() => ({ [key]: store[key] })),
        set: (items: Record<string, unknown>) => {
          Object.assign(store, items);
          return Promise.resolve();
        },
      },
    },
  };
  vi.resetModules();
  const mod = await import("./curtain-store.js");
  const hydrating = mod.hydrateCurtainState();
  return { ...mod, store, release, hydrating };
}

/**
 * The store keeps module-level state, so each case re-imports it fresh —
 * which doubles as a model of the service-worker death it exists to survive.
 */
async function freshStore(session?: Record<string, unknown>) {
  const store: Record<string, unknown> = session ? { ...session } : {};
  const set = vi.fn((items: Record<string, unknown>) => {
    Object.assign(store, items);
    return Promise.resolve();
  });
  (globalThis as Record<string, unknown>).chrome = {
    storage: {
      session: {
        get: (key: string) => Promise.resolve({ [key]: store[key] }),
        set,
      },
    },
  };
  vi.resetModules();
  const mod = await import("./curtain-store.js");
  return { ...mod, store, set };
}

describe("curtain-store", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("reports no curtain before anything is set", async () => {
    const s = await freshStore();
    expect(s.isCurtainOn(7)).toBe(false);
  });

  it("records a curtain and mirrors it into session storage", async () => {
    const s = await freshStore();
    s.setCurtain(7, true);

    expect(s.isCurtainOn(7)).toBe(true);
    await settle();
    expect(s.store.tabCurtainOn).toEqual({ "7": true });
  });

  it("drops the entry when the curtain is turned off", async () => {
    const s = await freshStore();
    s.setCurtain(7, true);
    s.setCurtain(7, false);

    expect(s.isCurtainOn(7)).toBe(false);
    await settle();
    expect(s.store.tabCurtainOn).toEqual({});
  });

  it("rehydrates a curtain persisted by a previous worker instance", async () => {
    // The exact post-service-worker-death case: module state is gone, the
    // page still has the curtain, session storage remembers.
    const s = await freshStore({ tabCurtainOn: { "7": true, "9": true } });
    expect(s.isCurtainOn(7)).toBe(false); // not yet hydrated

    await s.hydrateCurtainState();

    expect(s.isCurtainOn(7)).toBe(true);
    expect(s.isCurtainOn(9)).toBe(true);
  });

  it("hydrates only once even when awaited concurrently", async () => {
    const s = await freshStore({ tabCurtainOn: { "7": true } });
    await Promise.all([
      s.hydrateCurtainState(),
      s.hydrateCurtainState(),
      s.hydrateCurtainState(),
    ]);
    expect(s.isCurtainOn(7)).toBe(true);
  });

  it("does not let stale persisted state clobber a newer in-memory value", async () => {
    // The user turned the curtain OFF on this worker instance; a hydration
    // that lands afterwards must not resurrect the persisted `true`.
    const s = await freshStore({ tabCurtainOn: { "7": true } });
    s.setCurtain(7, false);
    await s.hydrateCurtainState();

    expect(s.isCurtainOn(7)).toBe(false);
  });

  it("a curtain turned off mid-hydration is not resurrected by the in-flight read", async () => {
    // The real boot-window race: `storage.session.get` is already in flight
    // when the user toggles the curtain off, so the read resolves with the
    // stale `true` AFTER the write. The local decision must win.
    const s = await storeMidHydration({ tabCurtainOn: { "7": true } });
    s.setCurtain(7, false); // user turns it off meanwhile
    s.release(); // stale read lands last
    await s.hydrating;

    expect(s.isCurtainOn(7)).toBe(false);
    await settle();
    expect(s.store.tabCurtainOn).toEqual({});
  });

  it("a write mid-hydration keeps the curtains a previous worker recorded", async () => {
    // Tab 7 was curtained before the worker died. A toggle on tab 12 during
    // the new worker's boot window must not replace the persisted map with
    // this worker's view of it, which doesn't know of tab 7 yet: a second
    // death would then forget tab 7's curtain.
    const s = await storeMidHydration({ tabCurtainOn: { "7": true } });
    s.setCurtain(12, true);
    await settle();
    expect(s.store.tabCurtainOn).toEqual({ "7": true }); // nothing written yet

    s.release();
    await s.hydrating;
    await settle();

    expect(s.store.tabCurtainOn).toEqual({ "7": true, "12": true });
  });

  it("a tab closed mid-hydration is not brought back by the in-flight read", async () => {
    const s = await storeMidHydration({ tabCurtainOn: { "7": true } });
    s.forgetTab(7);
    s.release();
    await s.hydrating;

    expect(s.isCurtainOn(7)).toBe(false);
    // Nor by the next worker: the entry is gone from storage too.
    await settle();
    expect(s.store.tabCurtainOn).toEqual({});
    const next = await freshStore(s.store);
    await next.hydrateCurtainState();
    expect(next.isCurtainOn(7)).toBe(false);
  });

  it("takeCurtainTabs returns the on-tabs and clears the store", async () => {
    const s = await freshStore();
    s.setCurtain(7, true);
    s.setCurtain(9, true);

    expect(s.takeCurtainTabs()).toEqual(new Set([7, 9]));
    // Cleared, so a later navigation can't re-apply a curtain we just lifted.
    expect(s.takeCurtainTabs()).toEqual(new Set());
    await settle();
    expect(s.store.tabCurtainOn).toEqual({});
  });

  it("forgetTab removes a closed tab without touching others", async () => {
    const s = await freshStore();
    s.setCurtain(7, true);
    s.setCurtain(9, true);
    s.forgetTab(7);

    expect(s.isCurtainOn(7)).toBe(false);
    expect(s.isCurtainOn(9)).toBe(true);
  });

  it("ignores malformed persisted payloads", async () => {
    const s = await freshStore({ tabCurtainOn: { notANumber: true, "9": 0 } });
    await s.hydrateCurtainState();

    expect(s.takeCurtainTabs()).toEqual(new Set());
  });

  it("degrades to memory-only when session storage is unavailable", async () => {
    // A browser that lacks storage.session (`storage` itself is a required
    // permission): the curtain must still work within one worker life.
    (globalThis as Record<string, unknown>).chrome = {};
    vi.resetModules();
    const s = await import("./curtain-store.js");

    await expect(s.hydrateCurtainState()).resolves.toBeUndefined();
    expect(() => s.setCurtain(7, true)).not.toThrow();
    expect(s.isCurtainOn(7)).toBe(true);
  });
});
