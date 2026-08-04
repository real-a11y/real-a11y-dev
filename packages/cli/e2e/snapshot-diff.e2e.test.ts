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

import { ARTIFACT_SCHEMA_VERSION } from "@real-a11y-dev/snapshot";
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
  it("writes a versioned artifact with fingerprinted findings", () => {
    const artifact = JSON.parse(readFileSync(base, "utf8")) as {
      schemaVersion: number;
      pages: {
        name: string;
        findings: { fingerprint: string }[];
        tree: string;
      }[];
    };
    expect(artifact.schemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
    expect(artifact.pages[0].name).toBe("Home");
    expect(artifact.pages[0].findings[0].fingerprint).toMatch(/^v1:/);
    expect(artifact.pages[0].tree).toContain("button");
  });

  it("errors (exit 2) when given no URLs", async () => {
    const { code, stderr } = await runCli(["snapshot"], { A11Y_PAGES: "" });
    expect(code).toBe(2);
    expect(stderr).toContain("needs URLs");
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
    expect(artifact.schemaVersion).toBe(ARTIFACT_SCHEMA_VERSION);
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

  it("keeps a secret out of the artifact when the page FAILS to open", async () => {
    // The error branch builds its page by hand rather than through
    // `buildSnapshotPage`, so it has its own chance to get redaction wrong —
    // and it did: the id was derived from the raw url while `url` beside it was
    // redacted, writing `?token=…` into the artifact, every fingerprint tuple
    // and the committed baseline. A failed navigation is if anything the
    // LIKELIER carrier of a token-bearing preview url, so it is tested here and
    // not left to the healthy path's coverage.
    //
    // Port 1 is privileged and unbound: the connection is refused promptly, so
    // this exercises the CliError branch without waiting on a timeout.
    const url = "http://127.0.0.1:1/callback?token=hunter2SECRET";
    const { stdout } = await runCli(["snapshot", url, "-q"], {
      A11Y_PAGES: "",
    });
    const artifact = JSON.parse(stdout) as {
      pages: { id: string; url: string; status: string }[];
    };
    const page = artifact.pages[0];
    expect(page.status).toBe("error");
    // The whole document, not just the fields we thought to check.
    expect(stdout).not.toContain("hunter2SECRET");
    expect(page.id).not.toContain("hunter2SECRET");
    // And the id still derives from the same redacted url as `url` does, so a
    // failed capture joins its healthy self in the base artifact — which is the
    // entire reason a broken page carries an id at all.
    expect(page.id).toBe("/callback?token=%5BREDACTED%5D");
  });
});

describe("diff", () => {
  it("exits 1 on a NEW finding (default fail-on error)", async () => {
    const { code, stdout } = await runCli(["diff", base, more]);
    expect(code).toBe(1);
    expect(stdout).toContain("+ new");
    expect(stdout.trimEnd().split("\n").at(-1)).toMatch(/^findings: 1 new/);
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

  it("is neutral by default (unified diff); --explain adds the summary", async () => {
    // more.json adds a second unlabeled button vs base — a new tree node.
    const neutral = await runCli(["diff", base, more, "--format", "md"]);
    // Neutral: a real unified diff (```diff + @@ hunk) + a hint, no statements.
    expect(neutral.stdout).toContain("```diff");
    expect(neutral.stdout).toContain("@@");
    expect(neutral.stdout).not.toContain("Interactive element added");
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
    expect(explained.stdout).toContain("Interactive element added: button");
    expect(explained.stdout).not.toContain("<details>");

    // JSON carries the full data regardless of --explain (machine surface).
    const json = await runCli(["diff", base, more, "--format", "json"]);
    const parsed = JSON.parse(json.stdout) as {
      skippedViews: string[];
      pages: { structural: { kind: string }[] }[];
    };
    expect(parsed.pages[0].structural.map((s) => s.kind)).toContain(
      "interactive-added",
    );
    // Neither artifact measured tab order (native carries none), so the diff
    // reports that axis as skipped rather than silently comparing "" to "".
    expect(parsed.skippedViews).toEqual(["tabs"]);
    // LF-only output on every platform (byte-stable report promise).
    expect(json.stdout).not.toContain("\r");
  });

  it("--max-lines caps the diff with a pointer to the full diff", async () => {
    const { stdout } = await runCli([
      "diff",
      base,
      more,
      "--format",
      "md",
      "--max-lines",
      "1",
    ]);
    expect(stdout).toMatch(/… \d+ more diff line/);
    expect(stdout).toContain("see the full diff in the job log");
  });

  it("structural drift alone never gates (advisory contract)", async () => {
    const { code } = await runCli(["diff", clean, clean]);
    expect(code).toBe(0);
    // base→more adds a finding AND structure; --fail-on never stays 0.
    const never = await runCli(["diff", base, more, "--fail-on", "never"]);
    expect(never.code).toBe(0);
  });

  it("--ignore-view-line drops matching lines from views and statements", async () => {
    // The predicate sees the TRIMMED line. Tab-order lines are unnumbered now,
    // so a single `^button$` pattern covers the button in BOTH the tree and tabs
    // views (it used to need a second `^\d+\. button$` for the numbered tabs).
    const { stdout } = await runCli([
      "diff",
      base,
      more,
      "--format",
      "json",
      "--ignore-view-line",
      "^button$",
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
