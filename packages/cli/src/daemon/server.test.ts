import { afterEach, describe, expect, it, vi } from "vitest";

import { DaemonServer } from "./server.js";

/**
 * Shutdown ordering: the browser is torn down before the bookkeeping files are
 * removed, and a hung teardown is bounded so the daemon always exits — leaving
 * the pidfile behind as the recovery breadcrumb for `session stop`.
 *
 * The server is never started, so no socket is created; `stop()` short-circuits
 * the server-close wait and goes straight to the teardown being tested.
 */
describe("DaemonServer.stop", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("removes session files only after the registry teardown finishes", async () => {
    const server = new DaemonServer({
      socketPath: "/tmp/real-a11y-test.sock",
      authToken: "t",
    });
    const internals = server as unknown as {
      registry: { stopAll: () => Promise<void> };
      removeOwnSessionFiles: () => Promise<void>;
    };
    const order: string[] = [];
    internals.registry.stopAll = async () => {
      order.push("stopAll");
    };
    internals.removeOwnSessionFiles = async () => {
      order.push("removeFiles");
    };

    await server.stop();
    expect(order).toEqual(["stopAll", "removeFiles"]);
  });

  it("resolves within the bound and keeps session files when teardown hangs", async () => {
    vi.useFakeTimers();
    const server = new DaemonServer({
      socketPath: "/tmp/real-a11y-test.sock",
      authToken: "t",
    });
    const internals = server as unknown as {
      registry: { stopAll: () => Promise<void> };
      removeOwnSessionFiles: () => Promise<void>;
    };
    let filesRemoved = false;
    internals.registry.stopAll = () => new Promise<void>(() => {});
    internals.removeOwnSessionFiles = async () => {
      filesRemoved = true;
    };

    const stopped = server.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    await stopped;
    expect(filesRemoved).toBe(false);
  });

  it("runs the teardown once for concurrent stop() calls", async () => {
    const server = new DaemonServer({
      socketPath: "/tmp/real-a11y-test.sock",
      authToken: "t",
    });
    const internals = server as unknown as {
      registry: { stopAll: () => Promise<void> };
    };
    let calls = 0;
    internals.registry.stopAll = async () => {
      calls++;
    };

    await Promise.all([server.stop(), server.stop()]);
    expect(calls).toBe(1);
  });
});
