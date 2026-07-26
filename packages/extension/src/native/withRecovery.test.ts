import { describe, expect, it } from "vitest";

import type { DogfoodEvent } from "./dogfood.js";

import { withRecovery } from "./index.js";

// A minimal stand-in for NativeDebuggerSession: each withDebugger() call
// consumes the next scripted behavior (throw = a mid-operation connection drop;
// otherwise return the given outcome). Records are captured so we can assert
// exactly which reattach events the recovery path logged.
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
    // First call throws (was attached, connection lost); retry succeeds.
    const s = fakeSession([
      { throw: true, outcome: { ok: false } },
      { outcome: { ok: true } },
    ]);
    await run(s);
    expect(s.records.map((r) => r.kind)).toEqual(["reattach-ok"]);
  });

  it("records reattach-failed when a mid-operation drop does not recover", async () => {
    const s = fakeSession([
      { throw: true, outcome: { ok: false } },
      { outcome: { ok: false, error: "attach-failed" } },
    ]);
    await run(s);
    expect(s.records.map((r) => r.kind)).toEqual(["reattach-failed"]);
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
