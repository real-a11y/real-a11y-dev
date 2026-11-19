import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { registerCleanup, runCleanups, STOP_GRACE_MS } from "./cleanup.js";

describe("interruptCommand", () => {
  // What a stop leaves behind is module-wide: each case gets its own.
  let cleanup: typeof import("./cleanup.js");

  beforeEach(async () => {
    vi.resetModules();
    cleanup = await import("./cleanup.js");
  });

  it("leaves a signal alone unless a command asked for it", () => {
    expect(cleanup.interruptCommand(1000)).toBe(false);
  });

  it("stops the command once", () => {
    const stop = vi.fn();
    cleanup.onInterrupt(stop);
    expect(cleanup.interruptCommand(1000)).toBe(true);
    expect(cleanup.interruptCommand(1001)).toBe(true);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it("takes a signal during the stop as the same Ctrl-C", () => {
    cleanup.onInterrupt(() => {});
    cleanup.interruptCommand(1000);
    expect(cleanup.interruptCommand(1000 + STOP_GRACE_MS - 1)).toBe(true);
  });

  it("lets a later signal out of a stop that hangs", () => {
    cleanup.onInterrupt(() => {});
    cleanup.interruptCommand(1000);
    expect(cleanup.interruptCommand(1000 + STOP_GRACE_MS)).toBe(false);
  });
});

describe("runCleanups", () => {
  // The registry is module-wide; drain it so a failed case can't leak into
  // the next one.
  afterEach(async () => {
    await runCleanups().catch(() => {});
  });

  it("runs every cleanup when one throws synchronously", async () => {
    const ran: string[] = [];
    registerCleanup(() => {
      throw new Error("sync failure");
    });
    registerCleanup(() => {
      ran.push("sync");
    });
    registerCleanup(async () => {
      ran.push("async");
    });

    await expect(runCleanups()).resolves.toBeUndefined();
    expect(ran).toEqual(["sync", "async"]);
  });

  it("runs every cleanup when one rejects", async () => {
    const ran: string[] = [];
    registerCleanup(async () => {
      throw new Error("async failure");
    });
    registerCleanup(() => {
      ran.push("after");
    });

    await expect(runCleanups()).resolves.toBeUndefined();
    expect(ran).toEqual(["after"]);
  });

  it("drains the registry, and an unregistered cleanup does not run", async () => {
    let calls = 0;
    registerCleanup(() => {
      calls++;
    });
    const unregister = registerCleanup(() => {
      calls += 100;
    });
    unregister();

    await runCleanups();
    await runCleanups();
    expect(calls).toBe(1);
  });
});
