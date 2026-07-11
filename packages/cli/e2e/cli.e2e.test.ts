/**
 * End-to-end: spawn the BUILT bin (`pnpm build` first) against data: URLs in
 * real headless Chromium — the mcp e2e conventions (no fixture server,
 * Windows-safe execFile of process.execPath, no .cmd shims).
 */

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

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
        env: {
          ...process.env,
          // Deterministic across dev machines and CI runners.
          NO_COLOR: "1",
          FORCE_COLOR: "",
          GITHUB_ACTIONS: "",
          GITHUB_STEP_SUMMARY: "",
          REAL_A11Y_MCP_ALLOW_FILE: "",
          ...env,
        },
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

const BAD_PAGE = dataUrl("<main><h1>Hi</h1><button></button></main>");
const CLEAN_PAGE = dataUrl(
  '<main><h1>Hi</h1><button aria-label="Save">S</button></main>',
);

describe("real-a11y (built bin)", () => {
  it("audit exits 1 on an unlabeled button, findings on stdout, progress on stderr", async () => {
    const { code, stdout, stderr } = await runCli(["audit", BAD_PAGE]);
    expect(code).toBe(1);
    expect(stdout).toContain("no-unlabeled-interactive");
    expect(stdout.trimEnd().split("\n").at(-1)).toMatch(/^1 issue /);
    expect(stderr).toContain("auditing");
    expect(stdout).not.toContain("\u001B[");
  });

  it("audit exits 0 on a clean page", async () => {
    const { code, stdout } = await runCli(["audit", CLEAN_PAGE]);
    expect(code).toBe(0);
    expect(stdout).toContain("No accessibility issues found.");
  });

  it("audit --fail-on never reports but exits 0", async () => {
    const { code } = await runCli(["audit", BAD_PAGE, "--fail-on", "never"]);
    expect(code).toBe(0);
  });

  it("audit --format json emits exactly one parseable document with fingerprints", async () => {
    const { code, stdout } = await runCli([
      "audit",
      BAD_PAGE,
      "--format",
      "json",
      "--quiet",
    ]);
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout) as {
      schemaVersion: number;
      pages: { findings: { fingerprint: string }[] }[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.pages[0].findings[0].fingerprint).toMatch(/^v1:/);
  });

  it("audits a local file passed as a positional — no flag ceremony", async () => {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-e2e-"));
    const file = join(dir, "page.html");
    writeFileSync(file, "<main><h1>t</h1><button></button></main>");
    const { code, stdout } = await runCli(["audit", file]);
    expect(code).toBe(1);
    expect(stdout).toContain("no-unlabeled-interactive");
  });

  it("tree prints the semantic view", async () => {
    const { code, stdout } = await runCli(["tree", CLEAN_PAGE]);
    expect(code).toBe(0);
    expect(stdout).toContain('heading "Hi"');
    expect(stdout).toContain('button "Save"');
  });

  it("audits under device emulation", async () => {
    const { code, stdout } = await runCli([
      "audit",
      CLEAN_PAGE,
      "--device",
      "iPhone 13",
    ]);
    expect(code).toBe(0);
    expect(stdout).toContain("No accessibility issues found.");
  });

  it("list button prints locators for the category", async () => {
    const { code, stdout } = await runCli(["list", "button", CLEAN_PAGE]);
    expect(code).toBe(0);
    expect(stdout).toContain('button "Save"');
  });

  it("fails fast (exit 2, no browser) on an unknown rule", async () => {
    const started = Date.now();
    const { code, stderr } = await runCli([
      "audit",
      BAD_PAGE,
      "--rules",
      "imgalt",
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain('unknown rule "imgalt"');
    expect(stderr).toContain("no-unlabeled-interactive");
    expect(Date.now() - started).toBeLessThan(5_000);
  });

  it("navigation failure exits 2, reported as a page error with a hint", async () => {
    const { code, stdout } = await runCli([
      "audit",
      "http://127.0.0.1:1/",
      "--timeout",
      "5000",
    ]);
    expect(code).toBe(2);
    expect(stdout).toContain("page failed: could not open");
    expect(stdout).toContain("is the server running?");
  });

  it("--help and --version exit 0; bare invocation exits 2", async () => {
    expect((await runCli(["--help"])).code).toBe(0);
    expect((await runCli(["--version"])).stdout).toMatch(/^real-a11y \d/);
    expect((await runCli([])).code).toBe(2);
  });

  it("emits grouped ::error annotations under GITHUB_ACTIONS", async () => {
    const { stderr } = await runCli(["audit", BAD_PAGE], {
      GITHUB_ACTIONS: "true",
    });
    const annotations = stderr
      .split("\n")
      .filter((l) => l.startsWith("::error"));
    expect(annotations).toHaveLength(1);
    expect(annotations[0]).toContain("title=no-unlabeled-interactive");
  });
});
