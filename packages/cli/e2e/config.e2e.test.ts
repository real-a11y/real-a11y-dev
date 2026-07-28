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
    });
    // no-unlabeled-interactive is filtered out by the config → clean → exit 0.
    const { code } = await runCli(["audit", UNLABELED, "-q"], dir);
    expect(code).toBe(0);
  });

  it("--no-config ignores it (the unlabeled button gates again)", async () => {
    config({
      defaults: { rules: ["image-alt"] },
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
    });
    const { code, stderr } = await runCli(["audit", UNLABELED, "-q"], dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/--format expects pretty \| json/);
  });

  it("a mistyped defaults value fails closed at load", async () => {
    config({
      defaults: { failOn: "sometimes" },
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
    });
    const { stderr } = await runCli(
      ["audit", CLEAN, "--cdp", "http://127.0.0.1:9", "-q"],
      dir,
    );
    // The fix: the mutual-exclusivity guard no longer trips on a config default.
    expect(stderr).not.toMatch(/can't be combined with/);
  });

  it("audit with no URL falls back to the config `urls` list", async () => {
    // The headline fix: list your routes once (here as a bare string), then run
    // `real-a11y audit` with no positional — no re-typing the URL.
    config({ urls: [CLEAN] });
    const { code } = await runCli(["audit", "-q"], dir);
    expect(code).toBe(0); // CLEAN has no findings
  });

  it("audit with no URL and no config list errors clearly", async () => {
    config({ defaults: { device: "iPhone 13" } }); // defaults only, no `urls`
    const { code, stderr } = await runCli(["audit", "-q"], dir);
    expect(code).toBe(2);
    expect(stderr).toMatch(/no URL given/);
  });

  it("a config defaults.root doesn't make snapshot refuse to run", async () => {
    // The counterpart to the rejection below: `defaults.root` is set for
    // `audit`'s benefit, and snapshot scopes per route instead. Erroring out
    // of every snapshot run over a default the user set for another command
    // would be absurd — it's ignored, exactly as before.
    config({ defaults: { root: "main" } });
    const out = join(dir, "out.json");
    const { code, stderr } = await runCli(
      ["snapshot", CLEAN, "-o", out, "-q"],
      dir,
    );
    expect(stderr).not.toMatch(/can't apply a single --root/);
    expect(code).toBe(0);
  });
});

describe("--root now applies to `tabs` alone (built bin)", () => {
  it("refuses a typed --root, naming the reason rather than 'Unknown option'", async () => {
    // The strict parser would answer with "Unknown option '--root'", which
    // reads like a typo rather than a deliberate removal. `--root` was a
    // documented flag on six commands, so people have it in scripts.
    const out = join(dir, "out.json");
    const { code, stderr } = await runCli(
      ["snapshot", CLEAN, "--root", "main", "-o", out, "-q"],
      dir,
    );
    expect(code).toBe(2);
    expect(stderr).toMatch(/whole-document accessibility tree/);
    expect(stderr).toMatch(/nothing for --root to scope/);
    // …and points at what still scopes.
    expect(stderr).toMatch(/tabs --root/);
  });

  it("refuses it on `audit` too, in the same words", async () => {
    const { code, stderr } = await runCli(
      ["audit", CLEAN, "--root", "main", "-q"],
      dir,
    );
    expect(code).toBe(2);
    expect(stderr).toMatch(/nothing for --root to scope/);
  });

  it("still accepts it on `tabs` — the one in-page read", async () => {
    const { code, stdout } = await runCli(
      ["tabs", CLEAN, "--root", "body", "-q"],
      dir,
    );
    expect(code).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it("stays silent on the commands that never open a page", async () => {
    // `diff`/`install`/`login` auto-discover the config too, but the warning
    // explains itself by saying the command reads Chromium's accessibility
    // tree — which for them is simply false, and noise in every CI log.
    config({ defaults: { root: "#app" } });
    const { stderr } = await runCli(["diff", "a.json", "b.json"], dir);
    expect(stderr).not.toMatch(/defaults\.root/);
  });

  it("warns — and keeps running — when a config `defaults.root` can't apply", async () => {
    // A hard error would red every CI that set this key, mid-beta, over config
    // that was correct when it was written.
    config({ defaults: { root: "#app" } });
    const { code, stderr } = await runCli(["audit", CLEAN, "-q"], dir);
    expect(code).toBe(0);
    expect(stderr).toMatch(/warning/);
    expect(stderr).toMatch(/`defaults\.root`/);
    expect(stderr).toMatch(/Only `tabs` still scopes/);
    // …and `tabs` itself, which still honours it, says nothing.
    const tabs = await runCli(["tabs", CLEAN, "-q"], dir);
    expect(tabs.stderr).not.toMatch(/defaults\\.root/);
  });

  it("advertises --root in `tabs --help` and nowhere else", async () => {
    const tabs = await runCli(["tabs", "--help"], dir);
    expect(tabs.stdout).toMatch(/--root <selector>/);
    // The others may MENTION it ("this command takes no --root") — what they
    // must not do is list it as an accepted flag.
    for (const command of ["snapshot", "audit", "inspect", "tree", "list"]) {
      const { stdout } = await runCli([command, "--help"], dir);
      expect(stdout, `${command} --help still lists --root`).not.toMatch(
        /--root <selector>/,
      );
    }
  });
});
