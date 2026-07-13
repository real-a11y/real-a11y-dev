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

  it("takes a positional URL like every other command (config optional)", async () => {
    const url = dataUrl("<main><h1>Hi</h1><button></button></main>");
    const { code, stdout } = await runCli(["snapshot", url, "-q"], {
      // No A11Y_PAGES and no config — the positional is the only page source.
      A11Y_PAGES: "",
    });
    expect(code).toBe(0);
    const artifact = JSON.parse(stdout) as {
      schemaVersion: number;
      pages: { name: string; url: string; findings: unknown[] }[];
    };
    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.pages).toHaveLength(1);
    // Page name defaults to the URL, matching `audit`/`tree`.
    expect(artifact.pages[0].name).toBe(artifact.pages[0].url);
    expect(artifact.pages[0].findings).toHaveLength(1);
  });

  it("snapshots several positional URLs into one artifact", async () => {
    const a = dataUrl("<main><h1>A</h1></main>");
    const b = dataUrl("<main><h1>B</h1><button></button></main>");
    const { code, stdout } = await runCli(["snapshot", a, b, "-q"], {
      A11Y_PAGES: "",
    });
    expect(code).toBe(0);
    const artifact = JSON.parse(stdout) as { pages: unknown[] };
    expect(artifact.pages).toHaveLength(2);
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

  it("is neutral by default; --explain adds the plain-language summary", async () => {
    // more.json adds a second unlabeled button vs base — a new tab stop.
    const neutral = await runCli(["diff", base, more, "--format", "md"]);
    // Neutral: raw diff + a hint, but NO plain-language statements.
    expect(neutral.stdout).toContain("**Raw view diff —");
    expect(neutral.stdout).not.toContain("Keyboard tab stop added");
    expect(neutral.stdout).toContain("Run with `--explain`");

    const explained = await runCli([
      "diff",
      base,
      more,
      "--format",
      "md",
      "--explain",
    ]);
    expect(explained.stdout).toContain(
      "**Structure (advisory — never blocks merge):**",
    );
    expect(explained.stdout).toContain("Keyboard tab stop added: button");
    expect(explained.stdout).not.toContain("<details>");

    // JSON carries the full data regardless of --explain (machine surface).
    const json = await runCli(["diff", base, more, "--format", "json"]);
    const parsed = JSON.parse(json.stdout) as {
      pages: { structural: { kind: string }[] }[];
    };
    expect(parsed.pages[0].structural.map((s) => s.kind)).toContain(
      "focus-stop-added",
    );
    // LF-only output on every platform (byte-stable report promise).
    expect(json.stdout).not.toContain("\r");
  });

  it("structural drift alone never gates (advisory contract)", async () => {
    const { code } = await runCli(["diff", clean, clean]);
    expect(code).toBe(0);
    // base→more adds a finding AND structure; --fail-on never stays 0.
    const never = await runCli(["diff", base, more, "--fail-on", "never"]);
    expect(never.code).toBe(0);
  });

  it("--ignore-view-line drops matching lines from views and statements", async () => {
    // Repeatable; the predicate sees the TRIMMED line, so the tabs pattern
    // must account for the `NN. ` counter still being present.
    const { stdout } = await runCli([
      "diff",
      base,
      more,
      "--format",
      "json",
      "--ignore-view-line",
      "^button$",
      "--ignore-view-line",
      String.raw`^\d+\. button$`,
    ]);
    const parsed = JSON.parse(stdout) as {
      pages: {
        views: { tree: { added: string[] }; tabs: { added: string[] } };
        structural: { kind: string }[];
      }[];
    };
    expect(parsed.pages[0].views.tree.added).toEqual([]);
    expect(parsed.pages[0].views.tabs.added).toEqual([]);
    expect(parsed.pages[0].structural).toEqual([]);
  });

  it("rejects an invalid --ignore-view-line regex (exit 2)", async () => {
    const { code, stderr } = await runCli([
      "diff",
      base,
      more,
      "--ignore-view-line",
      "([",
    ]);
    expect(code).toBe(2);
    expect(stderr).toContain("valid regular expression");
  });
});
