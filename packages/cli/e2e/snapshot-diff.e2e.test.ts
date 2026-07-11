/**
 * End-to-end for the CI product: `snapshot` writes a diffable artifact and
 * `diff` classifies two artifacts through the built bin. Snapshot drives real
 * Chromium via data: URLs; diff is pure and never launches a browser.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

const BIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(
  args: string[],
  env: NodeJS.ProcessEnv = {},
): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      {
        env: { ...process.env, NO_COLOR: "1", GITHUB_ACTIONS: "", ...env },
        windowsHide: true,
      },
      (error, stdout, stderr) => {
        const code =
          error && typeof error.code === "number" ? error.code : error ? 2 : 0;
        resolvePromise({ code, stdout, stderr });
      },
    );
  });
}

const dataUrl = (html: string): string =>
  `data:text/html,${encodeURIComponent(html)}`;
const pages = (html: string): string =>
  JSON.stringify([{ name: "Home", url: dataUrl(html) }]);

let dir: string;
let base: string;
let more: string;
let clean: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "real-a11y-p2-"));
  base = join(dir, "base.json");
  more = join(dir, "more.json");
  clean = join(dir, "clean.json");
  await runCli(["snapshot", "-o", base, "-q"], {
    A11Y_PAGES: pages("<main><h1>Hi</h1><button></button></main>"),
  });
  await runCli(["snapshot", "-o", more, "-q"], {
    A11Y_PAGES: pages(
      "<main><h1>Hi</h1><button></button><button></button></main>",
    ),
  });
  await runCli(["snapshot", "-o", clean, "-q"], {
    A11Y_PAGES: pages(
      '<main><h1>Hi</h1><button aria-label="Go">x</button></main>',
    ),
  });
}, 60_000);

describe("snapshot", () => {
  it("writes a schemaVersion-1 artifact with fingerprinted findings", () => {
    const artifact = JSON.parse(readFileSync(base, "utf8")) as {
      schemaVersion: number;
      pages: {
        name: string;
        findings: { fingerprint: string }[];
        tree: string;
      }[];
    };
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.pages[0].name).toBe("Home");
    expect(artifact.pages[0].findings[0].fingerprint).toMatch(/^v1:/);
    expect(artifact.pages[0].tree).toContain("button");
  });

  it("errors (exit 2) when given no pages", async () => {
    const { code, stderr } = await runCli(["snapshot"], { A11Y_PAGES: "" });
    expect(code).toBe(2);
    expect(stderr).toContain("needs pages");
  });
});

describe("diff", () => {
  it("exits 1 on a NEW finding (default fail-on error)", async () => {
    const { code, stdout } = await runCli(["diff", base, more]);
    expect(code).toBe(1);
    expect(stdout).toContain("+ new");
    expect(stdout.trimEnd().split("\n").at(-1)).toMatch(/^1 new/);
  });

  it("exits 0 when a finding is FIXED (fixes never gate)", async () => {
    const { code, stdout } = await runCli(["diff", base, clean]);
    expect(code).toBe(0);
    expect(stdout).toContain("- fixed");
  });

  it("exits 0 for identical snapshots", async () => {
    const { code, stdout } = await runCli(["diff", base, base]);
    expect(code).toBe(0);
    expect(stdout).toContain("0 new · 0 changed · 0 fixed");
  });

  it("--format json emits a parseable diff envelope", async () => {
    const { stdout } = await runCli(["diff", base, more, "--format", "json"]);
    const parsed = JSON.parse(stdout) as {
      command: string;
      summary: { new: number };
    };
    expect(parsed.command).toBe("diff");
    expect(parsed.summary.new).toBe(1);
  });

  it("rejects a schema-version mismatch with a re-snapshot hint", async () => {
    const bad = join(dir, "bad.json");
    const { writeFileSync } = await import("node:fs");
    writeFileSync(bad, JSON.stringify({ schemaVersion: 999, pages: [] }));
    const { code, stderr } = await runCli(["diff", bad, base]);
    expect(code).toBe(2);
    expect(stderr).toContain("schemaVersion 999");
  });
});
