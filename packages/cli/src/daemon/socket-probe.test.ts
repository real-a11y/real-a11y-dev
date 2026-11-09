import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { isSocketPresent } from "./socket-probe.js";

describe("isSocketPresent", () => {
  let dir: string | undefined;
  let server: Server | undefined;

  afterEach(async () => {
    await new Promise<void>((resolve) =>
      server ? server.close(() => resolve()) : resolve(),
    );
    server = undefined;
    if (dir) await rm(dir, { recursive: true, force: true });
    dir = undefined;
  });

  it("is false when nothing is listening", async () => {
    dir = await mkdtemp(join(tmpdir(), "probe-"));
    expect(await isSocketPresent(join(dir, "none.sock"))).toBe(false);
  });

  it("is true while a server listens, with the default and an explicit timeout", async () => {
    dir = await mkdtemp(join(tmpdir(), "probe-"));
    const socketPath = join(dir, "live.sock");
    server = createServer((s) => s.end());
    await new Promise<void>((resolve) => server!.listen(socketPath, resolve));
    expect(await isSocketPresent(socketPath)).toBe(true);
    expect(await isSocketPresent(socketPath, 1_000)).toBe(true);
  });
});
