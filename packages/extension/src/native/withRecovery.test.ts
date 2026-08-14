import { describe, expect, it } from "vitest";

import type { DogfoodEvent } from "./dogfood.js";

import { withRecovery } from "./index.js";

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

describe("the native-mode flag is re-checked before every attach", () => {
  it("refuses when the flag went off during the capability pre-flight", async () => {
    // The flag is read when the message arrives, but two chrome round-trips
    // (the capability pre-flight) happen before the attach. Unticking the box
    // in that window would otherwise raise the banner on a panel that had just
    // said native mode was off.
    const s = fakeSession([{ outcome: { ok: true } }]);
    const res = await withRecovery(
      s.session as any,
      1,
      async () => "tree",
      async () => false,
    );
    expect(res.outcome.ok).toBe(false);
    expect(res.outcome.error).toBe("native mode is off");
    expect(s.calls()).toBe(0); // never attached
    expect(s.records).toEqual([]);
  });

  it("refuses the retry when the flag went off mid-operation", async () => {
    // A recovery that re-attaches after the switch is off is exactly what
    // "off" is meant to preclude — and it would book a reattach for it too.
    const s = fakeSession([
      { outcome: { ok: false, error: "connection-lost" } },
      { outcome: { ok: true } },
    ]);
    let enabled = true;
    const res = await withRecovery(
      s.session as any,
      1,
      async () => "tree",
      async () => {
        const now = enabled;
        enabled = false; // the user unticks while the first attempt is in flight
        return now;
      },
    );
    expect(res.outcome.error).toBe("native mode is off");
    expect(s.calls()).toBe(1); // the first attach only, no retry
    expect(s.records).toEqual([]); // and no reattach-ok/failed either
  });

  it("defaults to enabled so existing callers are unchanged", async () => {
    const s = fakeSession([{ outcome: { ok: true } }]);
    const res = await withRecovery(s.session as any, 1, async () => "tree");
    expect(res.outcome.ok).toBe(true);
  });
});
