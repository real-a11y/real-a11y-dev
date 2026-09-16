import { beforeEach, describe, expect, it, vi } from "vitest";

import { isConnectionLost, NativeDebuggerSession } from "./debugger-session.js";
import type { DogfoodEvent } from "./dogfood.js";

/** In-memory stand-in for a chrome.storage area. */
class FakeStorage {
  data: Record<string, unknown> = {};
  async get(key: string) {
    return key in this.data ? { [key]: this.data[key] } : {};
  }
  async set(items: Record<string, unknown>) {
    Object.assign(this.data, items);
  }
}

type DetachListener = (
  source: { tabId?: number },
  reason: string,
) => void | Promise<void>;

/** Minimal chrome.debugger stub; captures the onDetach listeners registered. */
function stubChrome() {
  const listeners: DetachListener[] = [];
  const g = globalThis as unknown as { chrome: unknown };
  g.chrome = {
    debugger: {
      attach: vi.fn(async () => {}),
      detach: vi.fn(async () => {}),
      // The liveness probe `attach()` sends before trusting a reuse. Resolving
      // by default matches a genuinely live session; individual tests override
      // it to model a stale one.
      sendCommand: vi.fn(async () => ({})),
      onDetach: { addListener: (fn: DetachListener) => listeners.push(fn) },
    },
  };
  return listeners;
}

async function settle() {
  // Let the queued storage read-modify-writes drain.
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

function kinds(log: FakeStorage): string[] {
  const events = (log.data["dogfood.nativeLog"] ?? []) as DogfoodEvent[];
  return events.map((e) => e.kind);
}

describe("isConnectionLost", () => {
  it("recognizes a debuggee that went away", () => {
    for (const msg of [
      "Detached while handling command.",
      "Debugger is not attached to the tab with id: 7.",
      "Target closed.",
      "No target with given id found",
      // Chrome phrases this per target type, and `{ tabId }` — the only form
      // this module uses — yields the TAB wording. Matching only the `target`
      // spelling sent a closed tab down `detachIfLive`'s "plausibly still
      // attached" branch, which puts the entry BACK: the map never cleared and
      // every later revoke re-reported the same dead tab.
      "No tab with given id 7.",
    ]) {
      expect(isConnectionLost(msg)).toBe(true);
    }
  });

  it("is conservative — an ordinary command failure is not a drop", () => {
    // Over-tagging would inflate the reattach metric, so anything
    // unrecognized must fall through to `command-failed`.
    for (const msg of [
      "Invalid parameters",
      "Protocol error (Accessibility.getFullAXTree): Internal error",
      undefined,
    ]) {
      expect(isConnectionLost(msg)).toBe(false);
    }
  });
});

describe("NativeDebuggerSession attach bookkeeping", () => {
  let listeners: DetachListener[];
  beforeEach(() => {
    listeners = stubChrome();
  });

  it("records an unsolicited detach even after the worker restarted", async () => {
    // THE case the dogfood exists to measure: the MV3 suspend that drops the
    // debugger also destroys the worker's memory. A fresh session (new
    // instance, empty memory) must still attribute the drop — which only works
    // because the attach bookkeeping lives in storage.
    const log = new FakeStorage();
    const attach = new FakeStorage();

    const before = new NativeDebuggerSession(log, attach);
    await before.withDebugger(42, async () => "read");
    // Simulate being attached when the worker dies: re-add the entry, since a
    // completed operation detaches deliberately.
    attach.data["dogfood.attachedTabs"] = { 42: Date.now() - 5_000 };

    // Worker restarts: brand-new instance, brand-new listener, no memory.
    const listenersBefore = listeners.length;
    const after = new NativeDebuggerSession(log, attach);
    expect(listeners.length).toBe(listenersBefore + 1);

    await listeners[listeners.length - 1]({ tabId: 42 }, "target_closed");
    await settle();

    expect(kinds(log)).toContain("detach-unsolicited");
    expect(after).toBeDefined();
    // And the entry is consumed, so it can't be double-counted.
    expect(attach.data["dogfood.attachedTabs"]).toEqual({});
  });

  it("does not score its own surviving attachment as a DevTools conflict", async () => {
    // `runExclusive` only serializes within ONE worker generation. After an MV3
    // suspend the in-memory queue is empty while our own attachment — and its
    // storage entry — can still be live, so the next attach is refused with
    // "Another debugger is already attached". Chrome does not say WHO, and
    // scoring it as DevTools inflated one of the three headline metrics with a
    // self-collision. Our own bookkeeping is the discriminator.
    stubChrome();
    const g = globalThis as unknown as { chrome: typeof chrome };
    (g.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Another debugger is already attached to the tab with id: 5."),
    );
    const log = new FakeStorage();
    const attach = new FakeStorage();
    const attachedAt = Date.now() - 30_000;
    attach.data["dogfood.attachedTabs"] = { 5: attachedAt };
    const session = new NativeDebuggerSession(log, attach);

    const { outcome, value } = await session.withDebugger(5, async () => "ok");

    // The operation runs against the attachment we already hold.
    expect(outcome.ok).toBe(true);
    expect(value).toBe("ok");
    // No conflict recorded, and no second `attach` session either — the banner
    // never came down, so counting a new one would inflate the dwell average.
    expect(kinds(log)).not.toContain("conflict");
    expect(kinds(log)).not.toContain("attach");
    // And the eventual detach bills the FULL dwell — since 30s ago, not since
    // this operation started a moment ago. `detach()` derives it from the map's
    // own timestamp rather than a duration computed locally, which is what
    // makes this correct: crediting only this operation's slice would
    // undercount the banner-tolerance number by however long the attachment
    // survived the (simulated) worker restart that preceded it.
    const events = (log.data["dogfood.nativeLog"] ?? []) as DogfoodEvent[];
    const detach = events.find((e) => e.kind === "detach");
    expect(detach?.attachedMs).toBeGreaterThanOrEqual(29_000);
  });

  it("still reports a real DevTools conflict", async () => {
    // The other side of the discriminator: no entry of ours for this tab, so
    // the refusal really is somebody else holding it.
    stubChrome();
    const g = globalThis as unknown as { chrome: typeof chrome };
    (g.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Another debugger is already attached to the tab with id: 5."),
    );
    const log = new FakeStorage();
    const attach = new FakeStorage();
    const session = new NativeDebuggerSession(log, attach);

    const { outcome } = await session.withDebugger(5, async () => "ok");

    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("conflict");
    expect(kinds(log)).toContain("conflict");
  });

  it("does not reuse a stale entry that now belongs to someone else", async () => {
    // Bookkeeping proves we attached at SOME point, not that we still hold the
    // tab now. An unreported drop — the SW suspended mid-attachment and missed
    // `onDetach` — can leave a stale entry while Chrome's real attachment now
    // belongs to DevTools. Treating the entry alone as proof would dispatch
    // `fn()` against a connection we don't have, whose failure `withRecovery`
    // would then retry as a genuine mid-operation drop rather than the
    // stale-bookkeeping cleanup it actually is.
    stubChrome();
    const g = globalThis as unknown as { chrome: typeof chrome };
    (g.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Another debugger is already attached to the tab with id: 5."),
    );
    // The liveness probe fails: whoever holds the tab now, it isn't us.
    (
      g.chrome.debugger.sendCommand as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("Not allowed"));
    const log = new FakeStorage();
    const attach = new FakeStorage();
    attach.data["dogfood.attachedTabs"] = { 5: Date.now() - 30_000 };
    const session = new NativeDebuggerSession(log, attach);

    const { outcome, value } = await session.withDebugger(5, async () => "ok");

    // Reported as the real conflict it is — not a false success against a
    // session we don't hold.
    expect(outcome.ok).toBe(false);
    expect(outcome.error).toBe("conflict");
    expect(value).toBeUndefined();
    expect(kinds(log)).toContain("conflict");
    // The stale entry is cleared as bookkeeping cleanup, not a lifecycle
    // event — it never touches `detach-unsolicited`/`reattach-*`, which is the
    // MV3 headline metric this distinction protects.
    expect(kinds(log)).toContain("detach-stale");
    expect(kinds(log)).not.toContain("detach-unsolicited");
    expect(kinds(log)).not.toContain("detach");
    expect(attach.data["dogfood.attachedTabs"]).toEqual({});
  });

  it("ignores a detach for a tab it never attached to", async () => {
    const log = new FakeStorage();
    const attach = new FakeStorage();
    new NativeDebuggerSession(log, attach);
    await listeners[listeners.length - 1]({ tabId: 99 }, "canceled_by_user");
    await settle();
    expect(kinds(log)).not.toContain("detach-unsolicited");
  });

  it("classifies a lost connection separately from a failed command", async () => {
    const log = new FakeStorage();
    const session = new NativeDebuggerSession(log, new FakeStorage());

    const lost = await session.withDebugger(1, async () => {
      throw new Error("Detached while handling command.");
    });
    expect(lost.outcome.error).toBe("connection-lost");

    const failed = await session.withDebugger(1, async () => {
      throw new Error("Protocol error: Internal error");
    });
    expect(failed.outcome.error).toBe("command-failed");
  });

  it("records a mid-operation drop as unsolicited, never as deliberate", async () => {
    // The teardown claims the attach entry, which stops onDetach from
    // recording — so if it logged a plain `detach` the drop would vanish and
    // the report could read "unsolicited detaches: 0" beside a reattach count.
    const log = new FakeStorage();
    const attach = new FakeStorage();
    const session = new NativeDebuggerSession(log, attach);

    await session.withDebugger(3, async () => {
      throw new Error("Detached while handling command.");
    });
    await settle();

    expect(kinds(log)).toEqual(["attach", "detach-unsolicited"]);
    expect(kinds(log)).not.toContain("detach");
    expect(attach.data["dogfood.attachedTabs"]).toEqual({});
  });

  it("still records a plain command failure as a deliberate detach", async () => {
    const log = new FakeStorage();
    const session = new NativeDebuggerSession(log, new FakeStorage());
    await session.withDebugger(4, async () => {
      throw new Error("Protocol error: Internal error");
    });
    await settle();
    expect(kinds(log)).toEqual(["attach", "detach"]);
  });

  it("serializes overlapping operations on one tab, so we never collide with ourselves", async () => {
    // Chrome allows one debugger client per target. Two overlapping operations
    // would make our OWN second attach fail with "Another debugger is already
    // attached" — indistinguishable from DevTools holding the tab, so it would
    // be scored as a `conflict` and inflate a headline metric with a
    // self-inflicted collision. It would also detach out from under the first.
    const log = new FakeStorage();
    const session = new NativeDebuggerSession(log, new FakeStorage());

    let concurrent = 0;
    let maxConcurrent = 0;
    const op = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return "done";
    };

    const results = await Promise.all([
      session.withDebugger(1, op),
      session.withDebugger(1, op),
      session.withDebugger(1, op),
    ]);

    expect(maxConcurrent).toBe(1); // never overlapped
    expect(results.every((r) => r.outcome.ok)).toBe(true);
    // Three clean attach/detach pairs, and no conflict invented along the way.
    expect(kinds(log).filter((k) => k === "attach")).toHaveLength(3);
    expect(kinds(log).filter((k) => k === "detach")).toHaveLength(3);
    expect(kinds(log)).not.toContain("conflict");
  });

  it("still runs different tabs concurrently", async () => {
    const session = new NativeDebuggerSession(
      new FakeStorage(),
      new FakeStorage(),
    );
    let concurrent = 0;
    let maxConcurrent = 0;
    const op = async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 5));
      concurrent--;
      return "done";
    };
    await Promise.all([
      session.withDebugger(1, op),
      session.withDebugger(2, op),
    ]);
    expect(maxConcurrent).toBe(2); // per-tab lock, not a global one
  });

  it("records a deliberate detach once, and not as unsolicited", async () => {
    const log = new FakeStorage();
    const attach = new FakeStorage();
    const session = new NativeDebuggerSession(log, attach);
    await session.withDebugger(7, async () => "ok");
    await settle();
    expect(kinds(log)).toEqual(["attach", "detach"]);
    expect(attach.data["dogfood.attachedTabs"]).toEqual({});
  });
});

describe("detachAll (the revoke path)", () => {
  it("drops a live attachment stranded by a suspend, and counts it", async () => {
    // `debugger` cannot be an optional permission, so there is nothing to
    // revoke — "native off" can only mean "not attached". The case that
    // matters is an attachment whose `finally` never ran because MV3 tore the
    // worker down mid-operation: it survives in storage, and its banner
    // survives on the tab.
    stubChrome();
    const log = new FakeStorage();
    const attach = new FakeStorage();
    attach.data["dogfood.attachedTabs"] = {
      3: Date.now() - 1000,
      9: Date.now(),
    };
    const session = new NativeDebuggerSession(log, attach);

    expect(await session.detachAll()).toBe(2);
    await settle();

    const detach = (globalThis as unknown as { chrome: typeof chrome }).chrome
      .debugger.detach as ReturnType<typeof vi.fn>;
    expect(detach.mock.calls.map((c) => c[0])).toEqual([
      { tabId: 3 },
      { tabId: 9 },
    ]);
    expect(kinds(log)).toEqual(["detach", "detach"]);
    expect(attach.data["dogfood.attachedTabs"]).toEqual({});
  });

  it("clears the entry for a tab that has been closed", async () => {
    // The leak this regex gap caused: a closed tab's rejection went to the
    // "plausibly still attached" branch, which restores the entry. Nothing ever
    // removed it again, so the map grew a permanent dead entry and each revoke
    // re-reported it as `detach-refused` — noise in the capability split, and a
    // `detachAll` that could never reach a clean state.
    stubChrome();
    const g = globalThis as unknown as { chrome: typeof chrome };
    (g.chrome.debugger.detach as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("No tab with given id 7."),
    );
    const log = new FakeStorage();
    const attach = new FakeStorage();
    attach.data["dogfood.attachedTabs"] = { 7: Date.now() - 5_000 };
    const session = new NativeDebuggerSession(log, attach);

    expect(await session.detachAll()).toBe(0); // it was already gone
    await settle();

    // The entry is GONE, not restored — a second revoke has nothing to redo.
    expect(attach.data["dogfood.attachedTabs"]).toEqual({});
    const events = (log.data["dogfood.nativeLog"] ?? []) as DogfoodEvent[];
    expect(events.map((e) => e.reason)).toEqual(["already-gone"]);
  });

  it("does not bill stale bookkeeping to the banner-dwell metric", async () => {
    // An entry can outlive its attachment. Logging it as a clean detach would
    // add its age — potentially hours — to "total time attached", which is the
    // banner-tolerance number the ship/no-ship decision reads, and would tell
    // the user we detached from a tab whose banner was never up.
    stubChrome();
    const g = globalThis as unknown as { chrome: typeof chrome };
    (g.chrome.debugger.detach as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Debugger is not attached to the tab with id: 3."),
    );
    const log = new FakeStorage();
    const attach = new FakeStorage();
    attach.data["dogfood.attachedTabs"] = { 3: Date.now() - 6 * 3600_000 };
    const session = new NativeDebuggerSession(log, attach);

    expect(await session.detachAll()).toBe(0); // nothing was really attached
    await settle();

    const events = (log.data["dogfood.nativeLog"] ?? []) as DogfoodEvent[];
    expect(events).toHaveLength(1);
    // A distinct kind, NOT detach-unsolicited: revoke cleanup over an entry
    // Chrome had already dropped is neither a suspend nor a target-gone drop,
    // and folding it into that counter inflates the MV3 headline number.
    expect(events[0].kind).toBe("detach-stale");
    expect(events[0].reason).toBe("already-gone");
    // The point: no duration, so six stranded hours can't reach the total.
    expect(events[0].attachedMs).toBeUndefined();
    expect(attach.data["dogfood.attachedTabs"]).toEqual({});
  });

  it("waits for an in-flight operation instead of tearing it down", async () => {
    // Detaching around the per-tab queue makes a live CDP call throw, which is
    // classified `connection-lost` and RETRIED — so switching native off during
    // a read would re-attach right after, put the banner back, and book a
    // reattach that never happened.
    //
    // The assertion that matters is `detached === 0`. An earlier version of
    // this test awaited the revoke only AFTER releasing the operation, so
    // nothing was ever in flight across it: a `detachAll` that ran *around*
    // `runExclusive` instead of inside it passed unchanged, and the test that
    // was the sole guard for this regression guarded nothing.
    stubChrome();
    const log = new FakeStorage();
    const attach = new FakeStorage();
    const session = new NativeDebuggerSession(log, attach);

    let releaseOp: () => void = () => {};
    const opDone = new Promise<void>((r) => (releaseOp = r));
    let revoke: Promise<number> | undefined;
    const op = session.withDebugger(4, async () => {
      revoke = session.detachAll(); // issued while this operation holds the tab
      // Give the revoke every chance to barge through before we finish.
      for (let i = 0; i < 20; i++) await Promise.resolve();
      await opDone;
      return "ok";
    });

    releaseOp();
    await op;
    // 0 means it queued behind the operation and found nothing left to do.
    // 1 would mean it detached the tab out from under a live CDP call.
    expect(await revoke).toBe(0);
    await settle();
    expect(kinds(log)).toEqual(["attach", "detach"]);
    expect(attach.data["dogfood.attachedTabs"]).toEqual({});
  });

  it("cannot miss an attach that is still in flight", async () => {
    // The revoke reads the attach map on the storage queue; the attach writes
    // it there too. Before the enabled-check moved inside that transaction, an
    // attach parked in the CDP call was in neither the map nor refused — so
    // detachAll reported 0 and the banner went up *after* the panel said off.
    let releaseAttach: () => void = () => {};
    const attaching = new Promise<void>((r) => (releaseAttach = r));
    stubChrome();
    const g = globalThis as unknown as { chrome: typeof chrome };
    (g.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        await attaching;
      },
    );

    const log = new FakeStorage();
    const attachStore = new FakeStorage();
    let enabled = true;
    const session = new NativeDebuggerSession(
      log,
      attachStore,
      async () => enabled,
    );

    const op = session.withDebugger(7, async () => "ok");
    for (let i = 0; i < 10; i++) await Promise.resolve(); // parked in attach

    enabled = false; // the user unticks the box mid-attach
    const revoke = session.detachAll();
    releaseAttach();
    await op;
    await revoke;
    await settle();

    // Either the revoke detached it, or the attach undid itself. What must NOT
    // happen is an attachment surviving with the flag off — and "never written"
    // satisfies that as much as "written then emptied", so both shapes pass.
    expect(attachStore.data["dogfood.attachedTabs"] ?? {}).toEqual({});
  });

  it("does not resolve before an in-flight attach has settled", async () => {
    // The ORDER matters, not just the final state the previous test checks: if
    // `detachAll()` resolved before the pending attach settled, the panel could
    // report "native mode off — detached from 0 tab(s)" a beat before Chrome
    // even shows the "…is debugging this browser" banner for the attach that
    // was already on its way — a report that was true when it went out and
    // false a moment later reads the same to the user as one that was just
    // wrong.
    let releaseAttach: () => void = () => {};
    const attaching = new Promise<void>((r) => (releaseAttach = r));
    stubChrome();
    const g = globalThis as unknown as { chrome: typeof chrome };
    (g.chrome.debugger.attach as ReturnType<typeof vi.fn>).mockImplementation(
      async () => {
        await attaching;
      },
    );

    const log = new FakeStorage();
    const attachStore = new FakeStorage();
    let enabled = true;
    const session = new NativeDebuggerSession(
      log,
      attachStore,
      async () => enabled,
    );

    const order: string[] = [];
    const op = session
      .withDebugger(7, async () => "ok")
      .then((r) => {
        order.push("attach-settled");
        return r;
      });
    for (let i = 0; i < 10; i++) await Promise.resolve(); // parked in attach

    enabled = false; // the user unticks the box mid-attach
    const revoke = session.detachAll().then((n) => {
      order.push("revoke-resolved");
      return n;
    });
    // Give the revoke every chance to resolve before the attach does.
    for (let i = 0; i < 10; i++) await Promise.resolve();
    releaseAttach();
    await op;
    await revoke;

    expect(order).toEqual(["attach-settled", "revoke-resolved"]);
  });

  it("is a no-op when nothing is attached", async () => {
    stubChrome();
    const log = new FakeStorage();
    const session = new NativeDebuggerSession(log, new FakeStorage());
    expect(await session.detachAll()).toBe(0);
    await settle();
    expect(kinds(log)).toEqual([]);
  });
});
