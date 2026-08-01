/**
 * End-to-end: spawn the BUILT bin (`pnpm build` first) against data: URLs in
 * real headless Chromium — the mcp e2e conventions (no fixture server,
 * Windows-safe execFile of process.execPath, no .cmd shims).
 */

import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

// ── --producer native (Chromium's own a11y tree over CDP) ─────────────────────────
// A <video controls> builds its play/scrubber/mute controls in a CLOSED
// user-agent shadow root the DOM producer's in-page walk can't reach; the native
// producer, reading Chromium's own tree, does. These prove the flag threads
// through to the native producer and that the incompatibility guards fire.

const VIDEO_PAGE = dataUrl(
  '<main><h1>Player</h1><video controls width="160" height="90" ' +
    'src="data:video/mp4;base64,AAAA"></video><button>Save</button></main>',
);
const ICON_BTN_PAGE = dataUrl(
  "<main><h1>Hi</h1><button><svg width='10' height='10'></svg></button></main>",
);

describe("the native producer is the only producer (built bin)", () => {
  it("tree surfaces UA-shadow media controls no in-page walk can reach", async () => {
    const { code, stdout } = await runCli(["tree", VIDEO_PAGE]);
    expect(code).toBe(0);
    expect(stdout).toContain('heading "Player"');
    // The scrubber lives in the closed user-agent shadow root — this is the
    // reach the migration was for, and it is now the default.
    expect(stdout).toContain("slider");
    expect(stdout).toContain("video time scrubber");
  });

  it("outline prints the heading outline", async () => {
    const { code, stdout } = await runCli(["outline", VIDEO_PAGE]);
    expect(code).toBe(0);
    expect(stdout).toContain("h1 Player");
  });

  it("audit flags an unlabeled control from the native tree", async () => {
    const { code, stdout } = await runCli(["audit", ICON_BTN_PAGE]);
    expect(code).toBe(1);
    expect(stdout).toContain("no-unlabeled-interactive");
  });

  it("list reaches the same nodes as tree, with locators", async () => {
    const { code, stdout } = await runCli(["list", "heading", VIDEO_PAGE]);
    expect(code).toBe(0);
    expect(stdout).toContain('heading "Player"');
  });

  it("inspect agrees with audit on findings, and prints no tab-order section", async () => {
    // The accepted loss, and the gain that pays for it: `inspect` used to run
    // the DOM producer while `audit` could run native, so the two could report
    // different findings for the same page.
    const inspect = await runCli(["inspect", ICON_BTN_PAGE]);
    const audit = await runCli(["audit", ICON_BTN_PAGE]);
    expect(inspect.code).toBe(1);
    expect(inspect.stdout).toContain("no-unlabeled-interactive");
    expect(audit.stdout).toContain("no-unlabeled-interactive");
    // No tab-order section — and no EMPTY one either, which would read as
    // "nothing on this page is focusable".
    expect(inspect.stdout).toContain("== Semantic tree ==");
    expect(inspect.stdout).not.toContain("== Tab order ==");
  });

  it("tabs still reports the keyboard sequence, from the in-page walk", async () => {
    const { code, stdout } = await runCli(["tabs", ICON_BTN_PAGE]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/01\. /);
  });

  it("rejects --producer entirely — the axis is gone", async () => {
    const { code, stderr } = await runCli([
      "tree",
      VIDEO_PAGE,
      "--producer",
      "native",
    ]);
    expect(code).toBe(2);
    expect(stderr).toMatch(/Unknown option/);
  });
});

/**
 * The quick-start's tree output, checked against the tree the CLI actually
 * prints.
 *
 * This block went stale and nobody noticed for four producer changes: it claimed
 * a `main` root and two children for a page that has no landmark and four. Two
 * things made that survivable — it was written once in #140 and never
 * re-recorded, and documented OUTPUT is unguarded (`check/samples.mjs` validates
 * that documented invocations *parse* and says outright it does not check
 * semantics).
 *
 * What this pins is our half: if the producer changes what a tree looks like,
 * the quick-start fails the build instead of quietly lying. What it cannot see
 * is `example.com` changing its own markup — no test without network can — so
 * the fixture below is a copy, and its accuracy is a human's job. That is a real
 * limit, stated rather than papered over: it converts the failure that actually
 * happened into a build error and leaves the one that didn't as a manual check.
 */
describe("quick-start docs match the real tree (built bin)", () => {
  // example.com's markup: one wrapper div, an h1, two paragraphs, one link.
  // No <main> — which is the whole reason the documented `main` root was wrong.
  const EXAMPLE_DOT_COM = dataUrl(
    "<!doctype html><html><head><title>Example Domain</title></head><body>" +
      "<div><h1>Example Domain</h1>" +
      "<p>This domain is for use in illustrative examples in documents. You may use this " +
      "domain in literature without prior coordination or asking for permission.</p>" +
      '<p><a href="https://www.iana.org/domains/example">More information...</a></p>' +
      "</div></body></html>",
  );

  const HERE = dirname(fileURLToPath(import.meta.url));
  const COPIES = {
    "packages/cli/README.md": resolve(HERE, "../README.md"),
    "website/packages/cli.md": resolve(
      HERE,
      "../../../website/packages/cli.md",
    ),
  };

  /** The fenced block holding the quick-start tree, by its first line. */
  function treeBlock(file: string): string {
    const text = readFileSync(file, "utf8");
    const match = /\n```\n(document\n(?:.*\n)*?)```\n/.exec(text);
    if (!match) {
      throw new Error(
        `no fenced block starting with "document" in ${file} — ` +
          "the quick-start output block moved or was reworded",
      );
    }
    return match[1].trimEnd();
  }

  it("both copies are byte-identical", () => {
    // The `pr` skill's README/website sync rule, made mechanical: two copies
    // that drift are worse than one, because each looks authoritative.
    const [readme, website] = Object.values(COPIES).map(treeBlock);
    expect(readme).toBe(website);
  });

  it("is what `real-a11y tree` actually prints", async () => {
    const { code, stdout } = await runCli(["tree", EXAMPLE_DOT_COM, "-q"]);
    expect(code).toBe(0);
    expect(stdout.trimEnd()).toBe(treeBlock(COPIES["packages/cli/README.md"]));
  });
});
