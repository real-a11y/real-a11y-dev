import { beforeEach, describe, expect, it } from "vitest";

import type { DogfoodEvent } from "./dogfood.js";

import { withRecovery } from "./index.js";

/**
 * `withRecovery` now runs the capability pre-flight itself, so these tests need
 * a tab to classify. Default to an ordinary page; the pre-flight has its own
 * tests in capability.test.ts.
 */
function stubTab(url: string | undefined = "https://example.test/") {
  (globalThis as unknown as { chrome: unknown }).chrome = {
    tabs: { get: async () => ({ url }) },
    extension: { isAllowedFileSchemeAccess: async () => false },
  };
}

beforeEach(() => stubTab());

// A minimal stand-in for NativeDebuggerSession: each withDebugger() call
// consumes the next scripted behavior. `withDebugger` classifies mid-operation
// failures itself, so a drop arrives as `connection-lost` rather than a throw;
// `throw` here models something escaping that classification entirely. Records
// are captured so we can assert exactly which reattach events were logged.
function fakeSession(
  behaviors: Array<{ throw?: true; outcome: { ok: boolean; error?: string } }>,
) {
  const records: DogfoodEvent[] = [];
  let call = 0;
  const session = {
    async withDebugger() {
      const b = behaviors[Math.min(call, behaviors.length - 1)];
      call++;
      if (b.throw) throw new Error("connection dropped");
      return { outcome: b.outcome };
    },
    dogfoodLog() {
      return {
        async record(e: DogfoodEvent) {
          records.push(e);
        },
      };
    },
  };
  return { session, records, calls: () => call };
}

const run = (s: ReturnType<typeof fakeSession>) =>
  withRecovery(s.session as any, 1, async () => "tree");

describe("withRecovery reattach accounting", () => {
  it("records reattach-ok when a mid-operation drop recovers", async () => {
    const s = fakeSession([
      { outcome: { ok: false, error: "connection-lost" } },
      { outcome: { ok: true } },
    ]);
    await run(s);
    expect(s.records.map((r) => r.kind)).toEqual(["reattach-ok"]);
  });

  it("records reattach-failed when a mid-operation drop does not recover", async () => {
    const s = fakeSession([
      { outcome: { ok: false, error: "connection-lost" } },
      { outcome: { ok: false, error: "attach-failed" } },
    ]);
    await run(s);
    expect(s.records.map((r) => r.kind)).toEqual(["reattach-failed"]);
  });

  it("does NOT record a reattach for a CDP command failure", async () => {
    // readNativeTree does not swallow protocol errors the way dispatchNative
    // does, so a failed command surfaces as `command-failed`. It is retried
    // best-effort but is not a service-worker lifecycle event, so counting it
    // would inflate the metric the ship/no-ship decision rests on.
    const s = fakeSession([
      { outcome: { ok: false, error: "command-failed" } },
      { outcome: { ok: true } },
    ]);
    await run(s);
    expect(s.records).toHaveLength(0);
    expect(s.calls()).toBe(2); // still retried
  });

  it("treats an unclassifiable throw as command-failed, not a drop", async () => {
    // runGuarded's backstop must not guess `connection-lost`.
    const s = fakeSession([
      { throw: true, outcome: { ok: false } },
      { outcome: { ok: true } },
    ]);
    await run(s);
    expect(s.records).toHaveLength(0);
  });

  it("does NOT record a reattach for a plain attach failure (unattachable page)", async () => {
    // chrome:// / Web Store / debugger-forbidden tab: attach never succeeds.
    // It's retried best-effort but must not touch the lifecycle metric.
    const s = fakeSession([
      { outcome: { ok: false, error: "attach-failed" } },
      { outcome: { ok: false, error: "attach-failed" } },
    ]);
    await run(s);
    expect(s.records).toHaveLength(0);
    expect(s.calls()).toBe(2); // still retried once
  });

  it("does not retry or record a conflict", async () => {
    const s = fakeSession([{ outcome: { ok: false, error: "conflict" } }]);
    await run(s);
    expect(s.records).toHaveLength(0);
    expect(s.calls()).toBe(1); // no retry
  });
});

describe("withRecovery as the one funnel", () => {
  it("refuses an unattachable tab without attaching, and records the reason", async () => {
    // The pre-flight used to be hand-copied into NATIVE_READ only, so the same
    // blocked page answered `browser-ui` for a read and `attach-refused` for a
    // click. Both go through here now.
    stubTab("chrome://extensions/");
    const s = fakeSession([{ outcome: { ok: true } }]);
    const res = await withRecovery(
      s.session as any,
      1,
      async () => "tree",
      s.session.dogfoodLog() as any,
    );
    expect(res.outcome.error).toBe("unavailable");
    expect(res.outcome.reason).toBe("browser-ui");
    expect(s.calls()).toBe(0); // never attached, so never flashed the banner
    // And the refusal is RECORDED — the panel used to short-circuit before the
    // read, which is why five of the eight reason codes could never appear in
    // the Capability split at all.
    expect(s.records.map((r) => r.kind)).toEqual(["unavailable"]);
    expect(s.records[0].reason).toBe("browser-ui");
  });

  it("translates an attach refusal into the same vocabulary", async () => {
    const s = fakeSession([{ outcome: { ok: false, error: "conflict" } }]);
    const res = await withRecovery(
      s.session as any,
      1,
      async () => "tree",
      s.session.dogfoodLog() as any,
    );
    expect(res.outcome.reason).toBe("devtools-conflict");
    expect(s.records.map((r) => r.kind)).toEqual(["unavailable"]);
  });

  it("does not retry once native mode has been switched off", async () => {
    // `disabled` comes from inside the attach transaction. Retrying it would be
    // re-attaching against the answer the user just gave.
    const s = fakeSession([{ outcome: { ok: false, error: "disabled" } }]);
    const res = await withRecovery(s.session as any, 1, async () => "tree");
    expect(res.outcome.error).toBe("disabled");
    expect(s.calls()).toBe(1);
  });

  it("books an abandoned recovery rather than a silent gap", async () => {
    // The drop was already recorded upstream as `detach-unsolicited`. If the
    // retry is refused because native went off, neither ok nor failed is true —
    // without its own kind the ledger shows a debit with no credit, which reads
    // exactly like a drop that never needed recovery.
    const s = fakeSession([
      { outcome: { ok: false, error: "connection-lost" } },
      { outcome: { ok: false, error: "disabled" } },
    ]);
    await withRecovery(s.session as any, 1, async () => "tree");
    expect(s.records.map((r) => r.kind)).toEqual(["reattach-abandoned"]);
  });
});
