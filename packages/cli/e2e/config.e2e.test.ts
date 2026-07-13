/**
 * End-to-end for the `a11y.config.json` `defaults` layer through the built bin:
 * a config in the cwd seeds any flag a command doesn't pass, an explicit flag
 * wins, and `--no-config` opts out. `format` is validated per command.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, it } from "vitest";

const BIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runCli(args: string[], cwd: string): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { cwd, env: { ...process.env, NO_COLOR: "1" }, windowsHide: true },
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
// An unlabeled button trips `no-unlabeled-interactive` (error), but NOT
// `image-alt` — so a config that narrows rules to image-alt makes it pass.
const UNLABELED = dataUrl("<main><h1>Hi</h1><button></button></main>");
// A clean page — no findings — so a run's exit code reflects flag handling, not
// violations (snapshot's fail-on defaults to `never` regardless).
const CLEAN = dataUrl("<main><h1>Hi</h1></main>");

let dir: string;
function config(obj: unknown): void {
  writeFileSync(join(dir, "a11y.config.json"), JSON.stringify(obj));
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "real-a11y-cfg-e2e-"));
});

describe("a11y.config.json defaults (built bin)", () => {
  it("audit picks up defaults.rules from the cwd config", async () => {
    config({
      defaults: { rules: ["image-alt"] },
      pages: [{ name: "x", url: "http://x" }],
    });
    // no-unlabeled-interactive is filtered out by the config → clean → exit 0.
    const { code } = await runCli(["audit", UNLABELED, "-q"], dir);
    expect(code).toBe(0);
  });

  it("--no-config ignores it (the unlabeled button gates again)", async () => {
    config({
      defaults: { rules: ["image-alt"] },
      pages: [{ name: "x", url: "http://x" }],
    });
    const { code } = await runCli(
      ["audit", UNLABELED, "--no-config", "-q"],
      dir,
    );
    expect(code).toBe(1); // default rules run → the button is an error
  });

  it("an explicit flag overrides the config default", async () => {
    config({
      defaults: { rules: ["image-alt"] },
      pages: [{ name: "x", url: "http://x" }],
    });
    const { code } = await runCli(
      ["audit", UNLABELED, "--rules", "no-unlabeled-interactive", "-q"],
      dir,
    );
    expect(code).toBe(1); // the flag wins over defaults.rules
  });

  it("defaults.format is validated per command (sarif is snapshot-only)", async () => {
    config({
      defaults: { format: "sarif" },
      pages: [{ name: "x", url: "http://x" }],
    });
    const { code, stderr } = await runCli(["audit", UNLABELED, "-q"], dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/--format expects pretty \| json/);
  });

  it("a mistyped defaults value fails closed at load", async () => {
    config({
      defaults: { failOn: "sometimes" },
      pages: [{ name: "x", url: "http://x" }],
    });
    const { code, stderr } = await runCli(["audit", UNLABELED, "-q"], dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/defaults.failOn must be/);
  });

  it("an explicit --md wins over a config defaults.format (no conflict)", async () => {
    // Before the command-scoping/suppression fix, defaults.format seeded
    // values.format and snapshot's --md/--format guard hard-errored (exit 2),
    // blaming a --format the user never typed. --md must win.
    config({
      defaults: { format: "json" },
      pages: [{ name: "x", url: "http://x" }],
    });
    const out = join(dir, "out.md");
    const { code, stderr } = await runCli(
      ["snapshot", CLEAN, "--md", "-o", out, "-q"],
      dir,
    );
    expect(stderr).not.toMatch(/conflicts with/);
    expect(code).toBe(0); // clean page + snapshot fail-on `never`
  });

  it("a config defaults.device doesn't defeat an explicit --cdp", async () => {
    // The cdp/emulation guard must not fire on a config-seeded device — the run
    // gets past arg-parsing and fails only at the (unreachable) CDP endpoint.
    config({
      defaults: { device: "iPhone 13" },
      pages: [{ name: "x", url: "http://x" }],
    });
    const { stderr } = await runCli(
      ["audit", CLEAN, "--cdp", "http://127.0.0.1:9", "-q"],
      dir,
    );
    // The fix: the mutual-exclusivity guard no longer trips on a config default.
    expect(stderr).not.toMatch(/can't be combined with/);
  });
});
