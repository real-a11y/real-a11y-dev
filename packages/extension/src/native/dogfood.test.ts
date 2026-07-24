import { describe, expect, it } from "vitest";

import { DogfoodLog } from "./dogfood.js";

// In-memory storage area matching the chrome.storage.local subset DogfoodLog uses.
class FakeStorage {
  private data: Record<string, unknown> = {};
  async get(key: string) {
    return key in this.data ? { [key]: this.data[key] } : {};
  }
  async set(items: Record<string, unknown>) {
    Object.assign(this.data, items);
  }
}

describe("DogfoodLog", () => {
  it("records events and rolls at the cap", async () => {
    const log = new DogfoodLog(new FakeStorage());
    for (let i = 0; i < 600; i++) {
      await log.record({ kind: "read", at: i, rawCount: i });
    }
    const all = await log.all();
    expect(all).toHaveLength(500); // capped
    expect(all[0].rawCount).toBe(100); // oldest 100 dropped
    expect(all.at(-1)?.rawCount).toBe(599);
  });

  it("clear empties the log", async () => {
    const log = new DogfoodLog(new FakeStorage());
    await log.record({ kind: "attach", at: 1 });
    await log.clear();
    expect(await log.all()).toHaveLength(0);
  });

  it("report summarizes the three dogfood questions and never carries page text", async () => {
    const log = new DogfoodLog(new FakeStorage());
    await log.record({ kind: "attach", at: 1000 });
    await log.record({ kind: "detach", at: 6000, attachedMs: 5000 });
    await log.record({
      kind: "detach-unsolicited",
      at: 7000,
      reason: "target_closed",
    });
    await log.record({ kind: "reattach-ok", at: 7100 });
    await log.record({ kind: "conflict", at: 8000 });
    await log.record({ kind: "act", at: 9000, action: "click", success: true });

    const report = await log.report(9999);
    expect(report).toContain("attach sessions: 1");
    expect(report).toContain("total time attached: 5.0s");
    expect(report).toContain("unsolicited detaches");
    expect(report).toMatch(/reattach recovered: 1\s+failed: 0/);
    expect(report).toContain("attach refused (another debugger attached): 1");
    expect(report).toContain("actions dispatched: 1");
    // Content-free: only kinds/reasons/counts, never a typed value.
    expect(report).not.toMatch(/password|secret|@/);
  });
});
