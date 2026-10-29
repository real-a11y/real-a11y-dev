import { afterEach, describe, expect, it } from "vitest";

import { registerCleanup, runCleanups } from "./cleanup.js";

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
