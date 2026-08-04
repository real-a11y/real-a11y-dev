/**
 * End-to-end session daemon: the same socket-backed process keeps a page open
 * across independent `run` requests, so `tree` -> `click` -> `tree` sees the
 * state the interaction left behind.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { DaemonClient, spawnDaemon } from "../src/daemon/client.js";
import { sessionPaths } from "../src/daemon/spawn.js";

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

    const { stop, tokenFile } = await spawnDaemon(
      socketPath,
      pidfile,
      60_000,
      DAEMON_ENTRY,
    );
    const client = new DaemonClient({ socketPath, tokenFile });

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

describe("session lifecycle", () => {
  it("lists, stops, and stop-alls daemon sessions through the CLI", async () => {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-session-lifecycle-"));
    const fixture = join(dir, "fixture.html");
    writeFileSync(
      fixture,
      `<!doctype html>
<html>
  <body>
    <main>
      <h1>Session lifecycle fixture</h1>
      <button onclick="
        const out = document.getElementById('status');
        out.textContent = out.textContent === 'off' ? 'on' : 'off';
      ">Toggle</button>
      <p id="status">off</p>
    </main>
  </body>
</html>`,
    );

    const name = `lifecycle-${Date.now()}`;
    const url = fileUrl(fixture);

    try {
      const tree = await runCli([
        "tree",
        "--session",
        name,
        "--allow-file",
        url,
        "--quiet",
      ]);
      expect(tree.code).toBe(0);
      expect(tree.stdout).toContain('paragraph "off"');

      const list = await runCli([
        "session",
        "list",
        "--format",
        "json",
        "--no-config",
      ]);
      expect(list.code).toBe(0);
      const listBody = JSON.parse(list.stdout) as {
        schemaVersion: number;
        command: string;
        sessions: { name: string; status: string }[];
      };
      expect(listBody.schemaVersion).toBe(1);
      expect(listBody.command).toBe("session list");
      const ours = listBody.sessions.find((s) => s.name === name);
      expect(ours).toBeDefined();
      expect(ours?.status).toBe("running");

      const stop = await runCli([
        "session",
        "stop",
        name,
        "--quiet",
        "--no-config",
      ]);
      expect(stop.code).toBe(0);

      const list2 = await runCli([
        "session",
        "list",
        "--format",
        "json",
        "--no-config",
      ]);
      expect(list2.code).toBe(0);
      const names = (
        JSON.parse(list2.stdout) as {
          schemaVersion: number;
          command: string;
          sessions: { name: string }[];
        }
      ).sessions.map((s) => s.name);
      expect(names).not.toContain(name);
    } finally {
      await runCli(["session", "stop", name, "--quiet", "--no-config"]);
    }
  }, 90_000);
});

function fileUrl(path: string): string {
  return `file://${path}`;
}

function runCli(
  args: string[],
  env?: NodeJS.ProcessEnv,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      {
        env: { ...process.env, NO_COLOR: "1", ...env },
        timeout: 30_000,
      },
      (err, stdout, stderr) => {
        if (
          err &&
          (err as { code?: string | number | null }).code === undefined
        ) {
          reject(err);
          return;
        }
        resolve({
          code: (err?.code as number | undefined) ?? 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

describe("session daemon CLI routing", () => {
  it("routes the built CLI through a daemon with --session", async () => {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-daemon-cli-"));
    const fixture = join(dir, "fixture.html");
    writeFileSync(
      fixture,
      `<!doctype html>
<html>
  <body>
    <main>
      <h1>CLI daemon fixture</h1>
      <button onclick="
        const out = document.getElementById('status');
        out.textContent = out.textContent === 'off' ? 'on' : 'off';
      ">Toggle</button>
      <p id="status">off</p>
    </main>
  </body>
</html>`,
    );

    const name = "cli-demo";
    const paths = sessionPaths(name);
    const { stop, tokenFile } = await spawnDaemon(
      paths.socketPath,
      paths.pidfile,
      60_000,
      DAEMON_ENTRY,
      paths.tokenFile,
    );
    const client = new DaemonClient({
      socketPath: paths.socketPath,
      tokenFile,
    });

    try {
      const url = fileUrl(fixture);
      const tree1 = await runCli([
        "tree",
        "--session",
        name,
        "--allow-file",
        url,
        "--quiet",
      ]);
      expect(tree1.code).toBe(0);
      expect(tree1.stdout).toContain('paragraph "off"');

      const click = await runCli([
        "click",
        "--session",
        name,
        "--allow-file",
        url,
        "--quiet",
        "--role",
        "button",
        "--name",
        "Toggle",
      ]);
      expect(click.code).toBe(0);
      expect(click.stdout).toContain('paragraph "on"');

      const tree2 = await runCli([
        "tree",
        "--session",
        name,
        "--allow-file",
        url,
        "--quiet",
      ]);
      expect(tree2.code).toBe(0);
      expect(tree2.stdout).toContain('paragraph "on"');
    } finally {
      await client.stopAll();
      await stop();
    }
  }, 90_000);
});
