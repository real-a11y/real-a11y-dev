import { describe, expect, it } from "vitest";

import { DogfoodLog } from "./dogfood.js";

// In-memory storage area matching the chrome.storage.local subset DogfoodLog uses.
class FakeStorage {
  // Public so a test can seed a pre-existing snapshot (see the
  // counters-written-before-the-field-existed case).
  data: Record<string, unknown> = {};
  async get(key: string) {
    return key in this.data ? { [key]: this.data[key] } : {};
  }
  async set(items: Record<string, unknown>) {
    Object.assign(this.data, items);
  }
}

// Like FakeStorage but yields a microtask on every op, so concurrent
// read-modify-write callers interleave — surfacing a lost-update race unless
// DogfoodLog serializes its writes.
class YieldingStorage {
  private data: Record<string, unknown> = {};
  async get(key: string) {
    await Promise.resolve();
    return key in this.data ? { [key]: this.data[key] } : {};
  }
  async set(items: Record<string, unknown>) {
    await Promise.resolve();
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

  it("clear empties the log and resets the counters", async () => {
    const log = new DogfoodLog(new FakeStorage());
    await log.record({ kind: "attach", at: 1 });
    await log.clear();
    expect(await log.all()).toHaveLength(0);
    expect(await log.report(9999)).toContain("attach sessions: 0");
  });

  it("summary totals survive the raw-log cap", async () => {
    // The whole point of the dogfood is the summary counts; a >CAP session must
    // not undercount them just because the rolling raw log dropped old events.
    const log = new DogfoodLog(new FakeStorage());
    for (let i = 0; i < 600; i++) {
      await log.record({ kind: "read", at: i });
    }
    for (let i = 0; i < 30; i++) {
      await log.record({ kind: "attach", at: 10_000 + i });
      await log.record({ kind: "detach", at: 20_000 + i, attachedMs: 1000 });
    }

    // Raw log is still capped…
    expect(await log.all()).toHaveLength(500);

    // …but the summary reflects the true totals across all 660 events.
    const report = await log.report(99_999);
    expect(report).toContain("tree reads: 600");
    expect(report).toContain("attach sessions: 30");
    expect(report).toContain("total time attached: 30.0s");
    expect(report).toContain("events: 660");
  });

  it("serializes concurrent writers so no event or count is lost", async () => {
    // The onDetach listener records independently of an in-flight operation's
    // attach/read/detach records; without serialization the two read the same
    // snapshot and one set() clobbers the other. Fire 50 records at once over a
    // storage that yields between get and set to force the interleaving.
    const log = new DogfoodLog(new YieldingStorage());
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        log.record({ kind: "attach", at: i }),
      ),
    );
    expect(await log.all()).toHaveLength(50);
    expect(await log.report(0)).toContain("attach sessions: 50");
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

describe("capability instrumentation", () => {
  it("tallies unavailable events by reason, uncapped", async () => {
    // "How often was native unavailable, and why" is the capability question
    // the raw log stops answering once it rolls past CAP — and the answer
    // changes what the verdict should be: mostly `devtools-conflict` argues
    // for better conflict handling, mostly `browser-ui` argues users simply
    // live where native can never reach.
    const storage = new FakeStorage();
    const log = new DogfoodLog(storage);
    for (const reason of ["browser-ui", "devtools-conflict", "browser-ui"]) {
      await log.record({ kind: "unavailable", at: 1, reason });
    }
    const c = await log.counters();
    expect(c.unavailable).toBe(3);
    expect(c.unavailableByReason).toEqual({
      "browser-ui": 2,
      "devtools-conflict": 1,
    });

    const report = await log.report(0);
    expect(report).toContain("native unavailable: 3");
    expect(report).toContain("browser-ui: 2");
  });

  it("survives counters written before the field existed", async () => {
    // A dogfooder mid-exercise has a stored snapshot with no
    // `unavailableByReason`. A plain spread leaves it undefined, and the next
    // record() would throw on it — losing the log they had already gathered.
    const storage = new FakeStorage();
    storage.data["dogfood.nativeCounters"] = { attach: 4, read: 2 };
    const log = new DogfoodLog(storage);
    await log.record({ kind: "unavailable", at: 1, reason: "web-store" });
    const c = await log.counters();
    expect(c.attach).toBe(4);
    expect(c.unavailableByReason).toEqual({ "web-store": 1 });
  });
});
