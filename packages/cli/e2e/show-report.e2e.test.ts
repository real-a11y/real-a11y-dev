/**
 * End-to-end for `show-report` through the built bin: the server, the viewer
 * build the bin ships with, and how the command stops. No browser involved.
 */

import { execFile, spawn, type ChildProcess } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

const BIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);

interface Running {
  child: ChildProcess;
  url: string;
  stderr: () => string;
  exited: Promise<number | null>;
}

let cwd: string;
const running: ChildProcess[] = [];

/** Start the command and wait for the URL it prints on stdout. */
function showReport(args: string[] = []): Promise<Running> {
  const child = spawn(
    process.execPath,
    [BIN, "show-report", "--no-open", "--port", "0", ...args],
    { cwd, env: { ...process.env, NO_COLOR: "1" }, windowsHide: true },
  );
  running.push(child);
  let stderr = "";
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (chunk: string) => (stderr += chunk));
  const exited = new Promise<number | null>((done) =>
    child.on("exit", (code) => done(code)),
  );
  return new Promise((done, fail) => {
    let stdout = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      if (!stdout.includes("\n")) return;
      done({ child, url: stdout.trim(), stderr: () => stderr, exited });
    });
    void exited.then((code) =>
      fail(new Error(`exited ${code} before serving: ${stderr}`)),
    );
  });
}

function runCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((done) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd, env: { ...process.env, NO_COLOR: "1" }, windowsHide: true },
      (error, stdout, stderr) => {
        const code =
          typeof error?.code === "number" ? error.code : error ? 2 : 0;
        done({ code, stdout, stderr });
      },
    );
  });
}

function writeRecord(name: string): void {
  const dir = join(cwd, "a11y-snapshots", "records", "src-a-test-ts");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, name),
    JSON.stringify({ version: 2, test: name, file: "src/a.test.ts" }),
  );
}

beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), "real-a11y-show-report-e2e-"));
});

afterEach(async () => {
  // Windows won't delete a folder a running process has as its cwd.
  await Promise.all(
    running.splice(0).map(
      (child) =>
        new Promise<void>((done) => {
          if (child.exitCode !== null || child.signalCode !== null) {
            done();
            return;
          }
          child.once("exit", () => done());
          child.kill("SIGKILL");
        }),
    ),
  );
  rmSync(cwd, { recursive: true, force: true, maxRetries: 5 });
});

describe("real-a11y show-report", () => {
  it("ships the viewer it serves", async () => {
    writeRecord("one.json");
    const { url } = await showReport();

    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await (await fetch(url)).text();
    expect(page).toContain('<div id="app"></div>');

    const script = await fetch(`${url}viewer.js`);
    expect(script.status).toBe(200);
    expect(await script.text()).toContain("/__records/events");
    expect((await fetch(`${url}viewer.css`)).status).toBe(200);

    const data = (await (await fetch(`${url}__records`)).json()) as {
      records: { id: string }[];
    };
    expect(data.records.map((r) => r.id)).toEqual(["src-a-test-ts/one.json"]);
  });

  it("waits for a first run, and says so", async () => {
    const { url, stderr } = await showReport();
    const data = (await (await fetch(`${url}__records`)).json()) as {
      records: unknown[];
    };
    expect(data.records).toEqual([]);
    await expect.poll(stderr).toContain("no snapshots recorded yet");
    expect(existsSync(join(cwd, "a11y-snapshots"))).toBe(false);
  });

  it("reads a folder you name", async () => {
    mkdirSync(join(cwd, "reports", "records", "src"), { recursive: true });
    writeFileSync(
      join(cwd, "reports", "records", "src", "a.json"),
      JSON.stringify({ version: 2 }),
    );
    const { url } = await showReport(["reports"]);
    const data = (await (await fetch(`${url}__records`)).json()) as {
      records: { id: string }[];
    };
    expect(data.records.map((r) => r.id)).toEqual(["src/a.json"]);
  });

  // A signal can't be delivered to a process on Windows: `kill` ends it.
  it.skipIf(process.platform === "win32")(
    "stops cleanly on Ctrl+C",
    async () => {
      const { child, stderr, exited } = await showReport();
      child.kill("SIGINT");
      expect(await exited).toBe(0);
      expect(stderr()).not.toContain("interrupted");
    },
  );

  it("exits 2 on a URL, and names the commands that take one", async () => {
    const { code, stderr } = await runCli([
      "show-report",
      "https://example.com",
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain("not a URL");
    expect(stderr).toContain("real-a11y snapshot <url>");
  });

  it("exits 2 on a folder that isn't there", async () => {
    const { code, stderr } = await runCli(["show-report", "missing"]);
    expect(code).toBe(2);
    expect(stderr).toContain("no such folder");
  });

  it("exits 2 on a bad port", async () => {
    const { code, stderr } = await runCli(["show-report", "--port", "99999"]);
    expect(code).toBe(2);
    expect(stderr).toContain("--port expects");
  });

  it("is listed in the help", async () => {
    const root = await runCli(["--help"]);
    expect(root.stdout).toContain("show-report [dir]");
    const own = await runCli(["show-report", "--help"]);
    expect(own.code).toBe(0);
    expect(own.stdout).toContain("Usage: real-a11y show-report [dir] [flags]");
  });
});
