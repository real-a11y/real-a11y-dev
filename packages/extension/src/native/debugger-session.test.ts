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
