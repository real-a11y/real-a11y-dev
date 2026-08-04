/**
 * End-to-end session daemon: the same socket-backed process keeps a page open
 * across independent `run` requests, so `tree` -> `click` -> `tree` sees the
 * state the interaction left behind.
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DaemonClient, spawnDaemon } from "../src/daemon/client.js";

const BIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);

const DAEMON_ENTRY = resolve(dirname(BIN), "daemon/entry.js");

function makeRunDir(): string {
  return mkdtempSync(join(tmpdir(), "real-a11y-daemon-"));
}

describe("session daemon", () => {
  it("reuses a page across tree, click, and tree", async () => {
    const dir = makeRunDir();
    const socketPath = join(dir, "daemon.sock");
    const pidfile = join(dir, "daemon.pid");

    const fixture = join(dir, "fixture.html");
    writeFileSync(
      fixture,
      `<!doctype html>
<html>
  <body>
    <main>
      <h1>Session daemon fixture</h1>
      <button onclick="
        const out = document.getElementById('status');
        out.textContent = out.textContent === 'off' ? 'on' : 'off';
      ">Toggle</button>
      <p id="status">off</p>
    </main>
  </body>
</html>`,
    );

    const stop = await spawnDaemon(socketPath, pidfile, 0, DAEMON_ENTRY);
    const client = new DaemonClient({ socketPath });

    try {
      const tree1 = await client.run("demo", "tree", [fileUrl(fixture)], {
        "allow-file": true,
        quiet: true,
      });
      expect(tree1.exitCode).toBe(0);
      expect(tree1.stdout).toContain('paragraph "off"');

      const click = await client.run("demo", "click", [fileUrl(fixture)], {
        "allow-file": true,
        quiet: true,
        role: "button",
        name: "Toggle",
      });
      expect(click.exitCode).toBe(0);
      expect(click.stdout).toContain('paragraph "on"');

      const tree2 = await client.run("demo", "tree", [fileUrl(fixture)], {
        "allow-file": true,
        quiet: true,
      });
      expect(tree2.exitCode).toBe(0);
      expect(tree2.stdout).toContain('paragraph "on"');

      const list = await client.list();
      expect(list).toHaveLength(1);
      expect(list[0].name).toBe("demo");
      expect(list[0].busy).toBe(false);
    } finally {
      await client.stopAll();
      await stop();
    }
  }, 60_000);
});

function fileUrl(path: string): string {
  return `file://${path}`;
}
