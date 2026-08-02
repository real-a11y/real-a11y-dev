import { describe, expect, it } from "vitest";

import { SessionRegistry } from "./registry.js";

class FakeSession {
  closed = false;
  constructor(public url: string = "") {}
  currentUrl(): string | undefined {
    return this.url || undefined;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

function makeRegistry(
  options: ConstructorParameters<typeof SessionRegistry<FakeSession>>[0] = {},
): SessionRegistry<FakeSession> {
  return new SessionRegistry<FakeSession>({
    idleTimeoutMs: 1000,
    ...options,
  });
}

describe("SessionRegistry", () => {
  it("creates a session on first use and reuses it for subsequent runs", async () => {
    const registry = makeRegistry();
    let created = 0;
    const factory = async (): Promise<FakeSession> => {
      created++;
      return new FakeSession("page-a");
    };

    const run1 = await registry.run("alpha", {}, 0, factory, async (s) => {
      s.url = "page-a";
      return 0;
    });
    const run2 = await registry.run("alpha", {}, 0, factory, async (s) => {
      expect(s.url).toBe("page-a");
      return 0;
    });

    expect(run1).toBe(0);
    expect(run2).toBe(0);
    expect(created).toBe(1);
    expect(registry.list()).toHaveLength(1);
  });

  it("serialises work per session", async () => {
    const registry = makeRegistry();
    const order: string[] = [];
    const factory = async (): Promise<FakeSession> => new FakeSession();

    const a = registry.run("s", {}, 0, factory, async () => {
      order.push("a-start");
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push("a-end");
      return 1;
    });
    const b = registry.run("s", {}, 0, factory, async () => {
      order.push("b-start");
      return 2;
    });

    const [ra, rb] = await Promise.all([a, b]);
    expect(ra).toBe(1);
    expect(rb).toBe(2);
    expect(order).toEqual(["a-start", "a-end", "b-start"]);
  });

  it("runs independent sessions in parallel", async () => {
    const registry = makeRegistry();
    let created = 0;
    const factory = async (): Promise<FakeSession> => {
      created++;
      return new FakeSession();
    };

    const [r1, r2] = await Promise.all([
      registry.run("one", {}, 0, factory, async () => 1),
      registry.run("two", {}, 0, factory, async () => 2),
    ]);
    expect(r1).toBe(1);
    expect(r2).toBe(2);
    expect(created).toBe(2);
  });

  it("stops a named session and closes it", async () => {
    const registry = makeRegistry();
    const session = new FakeSession();
    await registry.run(
      "x",
      {},
      0,
      async () => session,
      async () => 0,
    );
    expect(session.closed).toBe(false);
    const stopped = await registry.stop("x");
    expect(stopped).toBe(true);
    expect(session.closed).toBe(true);
    await expect(registry.stop("x")).resolves.toBe(false);
  });

  it("stops all sessions", async () => {
    const registry = makeRegistry();
    const a = new FakeSession();
    const b = new FakeSession();
    await registry.run(
      "a",
      {},
      0,
      async () => a,
      async () => 0,
    );
    await registry.run(
      "b",
      {},
      0,
      async () => b,
      async () => 0,
    );
    await registry.stopAll();
    expect(a.closed).toBe(true);
    expect(b.closed).toBe(true);
    expect(registry.list()).toHaveLength(0);
  });

  it("rejects a run with mismatched browser flags while the session is being created", async () => {
    const registry = makeRegistry();
    let created = 0;
    const factory = async (): Promise<FakeSession> => {
      created++;
      await new Promise((resolve) => setTimeout(resolve, 50));
      return new FakeSession();
    };

    const first = registry.run(
      "alpha",
      { headful: true },
      0,
      factory,
      async () => 0,
    );
    const second = registry.run(
      "alpha",
      { headful: false },
      0,
      factory,
      async () => 0,
    );

    const [r1, r2] = await Promise.allSettled([first, second]);
    expect(r1.status).toBe("fulfilled");
    expect(r1.status === "fulfilled" ? r1.value : undefined).toBe(0);
    expect(r2.status).toBe("rejected");
    if (r2.status === "rejected") {
      expect(String(r2.reason)).toMatch(/different browser flags/);
    }
    expect(created).toBe(1);
  });

  it("allows reuse when the requested origins are a subset of the pinned ones", async () => {
    const registry = makeRegistry();
    const factory = async (): Promise<FakeSession> => new FakeSession();

    await registry.run(
      "s",
      { allowedOrigins: ["https://a.example", "https://b.example"] },
      0,
      factory,
      async () => 1,
    );
    const r2 = await registry.run(
      "s",
      { allowedOrigins: ["https://a.example"] },
      0,
      factory,
      async () => 2,
    );
    expect(r2).toBe(2);
  });

  it("rejects reuse when the requested origins exceed the pinned ones", async () => {
    const registry = makeRegistry();
    const factory = async (): Promise<FakeSession> => new FakeSession();

    await registry.run(
      "s",
      { allowedOrigins: ["https://a.example"] },
      0,
      factory,
      async () => 1,
    );
    await expect(
      registry.run(
        "s",
        { allowedOrigins: ["https://a.example", "https://c.example"] },
        0,
        factory,
        async () => 2,
      ),
    ).rejects.toThrow(/does not include all requested origins/);
  });

  it("fires the idle timeout callback", async () => {
    let fired = false;
    const registry = makeRegistry({
      idleTimeoutMs: 50,
      onIdleTimeout: () => {
        fired = true;
      },
    });
    await registry.run(
      "x",
      {},
      50,
      async () => new FakeSession(),
      async () => 0,
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(fired).toBe(true);
  });
});
