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

  it("tabs lists only the stops Chromium actually tabs to", async () => {
    // The expected list is Chromium's own Tab walk of this page. The in-page
    // walk used to list the two href-less anchors, the button in the disabled
    // fieldset and the div with an empty tabindex, which Chromium never
    // focuses, and to drop the aria-disabled button, which it does.
    const page = dataUrl(
      "<!doctype html><title>Stops</title><main>" +
        '<a name="top">Back to top anchor</a>' +
        '<a role="button">Fake button</a>' +
        '<a href="/docs">Docs</a>' +
        '<button aria-disabled="true">Publish</button>' +
        "<fieldset disabled><legend><button>Unlock</button></legend>" +
        "<button>Save</button></fieldset>" +
        '<div tabindex="">Card</div>' +
        "</main>",
    );
    const { code, stdout } = await runCli(["tabs", page, "-q"]);
    expect(code).toBe(0);
    expect(stdout.trimEnd()).toBe(
      ['01. link "Docs"', '02. button "Publish"', '03. button "Unlock"'].join(
        "\n",
      ),
    );
  });

  it("tabs lists a details' summary, as Chromium tabs to it", async () => {
    // The expected list is Chromium 151's own Tab walk of this page. The
    // in-page walk used to skip every summary, so a disclosure or FAQ toggle
    // never showed up as a stop. Only the first summary child of a details
    // is one, and an inert one is none, which only a real browser's walk
    // shows end to end.
    const page = dataUrl(
      "<!doctype html><title>FAQ</title><main>" +
        "<button>Before</button>" +
        "<details><summary>Shipping</summary><p>3 to 5 days.</p></details>" +
        "<details open><p>Lead</p><summary>Returns</summary>" +
        "<summary>Second summary</summary></details>" +
        "<div><summary>Stray summary</summary></div>" +
        "<div inert><details><summary>Inert</summary></details></div>" +
        "<fieldset disabled><details><summary>Warranty</summary></details>" +
        "</fieldset>" +
        '<a href="/faq">All questions</a>' +
        "</main>",
    );
    const { code, stdout } = await runCli(["tabs", page, "-q"]);
    expect(code).toBe(0);
    expect(stdout.trimEnd()).toBe(
      [
        '01. button "Before"',
        '02. generic "Shipping"',
        '03. generic "Returns"',
        '04. generic "Warranty"',
        '05. link "All questions"',
      ].join("\n"),
    );
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
    // Port 1 is a port Chrome refuses outright, so the hint must say that
    // rather than offer the timeout advice this once printed for every cause.
    expect(stdout).toContain("Chrome refuses to connect on this port");
    expect(stdout).not.toContain("--wait-until");
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
// A rich-text composer: an editor with a link typed into it and a mention chip
// in a contenteditable="false" island, and a second, role-less editor.
const COMPOSER_PAGE = dataUrl(
  "<!doctype html><title>Composer</title><main><h1>Compose</h1>" +
    '<div id="composer" contenteditable="true" role="textbox" aria-label="Message">' +
    '<p>Reset link: <a href="https://x.test/reset?token=abc123">https://x.test/reset?token=abc123</a></p>' +
    "<h3>Q3 layoffs plan</h3>" +
    '<p>cc <a contenteditable="false" href="/u/alice" aria-label="Mention Alice">@alice</a></p>' +
    "</div>" +
    '<article><div contenteditable="true">my password is hunter2</div></article>' +
    "</main>",
);
// Chromium names neither: an image and a dialog are named by their author only,
// and the text inside them is not a name.
const TEXT_ONLY_PAGE = dataUrl(
  "<main><h1>Hi</h1><span role='img'>🎉</span>" +
    "<div role='dialog'>Unsaved changes</div></main>",
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

  it("audit flags an image and a dialog whose only text is their content", async () => {
    const { code, stdout } = await runCli([
      "audit",
      TEXT_ONLY_PAGE,
      "--format",
      "json",
      "--quiet",
    ]);
    expect(code).toBe(1);
    const parsed = JSON.parse(stdout) as {
      pages: { findings: { rule: string }[] }[];
    };
    const rules = parsed.pages[0].findings.map((f) => f.rule);
    expect(rules).toContain("image-alt");
    expect(rules).toContain("dialog-labeled");

    const tree = await runCli(["tree", TEXT_ONLY_PAGE]);
    expect(tree.stdout).toMatch(/^\s*img$/m);
    expect(tree.stdout).toMatch(/^\s*dialog$/m);
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

  it("shows a rich-text editor's content by default; --redact-input keeps it out of tree, audit and json", async () => {
    // What sits in a composer is page content a screen reader reads, so the
    // default tree shows it (ADR-0001). The strict mode withholds it: the
    // nodes inside must not carry it out as names, a link's URL, or a
    // heading-order message.
    // The page writes the editor's content at runtime from a split literal,
    // so the sentinel is not in the data: URL — which stderr and the json
    // envelope both echo, and which is this page's whole source.
    const EDITOR_PAGE = dataUrl(`<main><h1>Compose</h1>
      <div contenteditable="true" role="textbox" aria-label="Message">
        <p>draft <span class="s">p</span> <a class="s-href"><span class="s">link</span></a></p>
        <h3 class="s">heading</h3>
      </div>
      <article><div contenteditable="true" class="s">plain</div></article>
      <script>
        const S = "EDITOR-" + "SECRET-";
        for (const el of document.querySelectorAll(".s")) el.textContent = S + el.textContent;
        document.querySelector(".s-href").href = "https://x.test/?token=" + S + "href";
      </script>
    </main>`);
    expect(EDITOR_PAGE).not.toContain("EDITOR-SECRET");

    const shown = await runCli(["tree", EDITOR_PAGE]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain('heading "EDITOR-SECRET-heading" (level 3)');
    // A role-less editor is a field of its own, holding its text.
    expect(shown.stdout).toContain('generic = "EDITOR-SECRET-plain"');

    for (const args of [
      ["tree", EDITOR_PAGE],
      ["tree", EDITOR_PAGE, "-f", "json"],
      ["outline", EDITOR_PAGE],
      ["audit", EDITOR_PAGE, "-f", "json"],
    ]) {
      const { stdout, stderr } = await runCli([...args, "--redact-input"]);
      expect(stdout).not.toContain("EDITOR-SECRET");
      expect(stderr).not.toContain("EDITOR-SECRET");
    }
    const { code, stdout } = await runCli([
      "tree",
      EDITOR_PAGE,
      "--redact-input",
    ]);
    expect(code).toBe(0);
    // The structure is all still there; only the typed words are withheld.
    expect(stdout).toContain('textbox "Message"');
    expect(stdout).toContain('link "[redacted]"');
    expect(stdout).toContain('heading "[redacted]" (level 3)');
    // …and the withheld link is not reported as unlabeled: its name exists.
    const audit = await runCli(["audit", EDITOR_PAGE, "--redact-input"]);
    expect(audit.stdout).not.toContain("no-unlabeled-interactive");
  });

  it("tabs still reports the keyboard sequence, from the in-page walk", async () => {
    const { code, stdout } = await runCli(["tabs", ICON_BTN_PAGE]);
    expect(code).toBe(0);
    expect(stdout).toMatch(/01\. /);
  });

  it("tabs skips the controls in a closed <details>' body", async () => {
    // Chromium 151's Tab walk of this page reaches the summaries S and O, the
    // open disclosure's link and "Visible", never the closed body or the
    // details nested in it. Whether a rendered summary is itself a stop is a
    // separate rule, so those two lines are left out of the comparison.
    const page = dataUrl(
      "<!doctype html><title>Details</title><main>" +
        "<details><summary>S</summary>" +
        "<a href='/x'>Hidden link</a><button>Hidden button</button>" +
        "<details><summary>Nested</summary><a href='/n'>Nested link</a></details>" +
        "</details>" +
        "<details open><summary>O</summary><a href='/o'>Open link</a></details>" +
        "<a href='/y'>Visible</a></main>",
    );
    const { code, stdout } = await runCli(["tabs", page, "-q"]);
    expect(code).toBe(0);
    const stops = stdout
      .trimEnd()
      .split("\n")
      .map((line) => line.replace(/^\d+\. /, ""))
      .filter((stop) => !/^\S+ "(S|O)"$/.test(stop));
    expect(stops).toEqual(['link "Open link"', 'link "Visible"']);
  });

  it("tabs stops at each editor and its island link, never at a link typed into one", async () => {
    // Chromium tabs to both editing hosts and to the contenteditable="false"
    // mention chip, and can't focus the link typed into the composer at all.
    // That link used to be listed under its own text — here, a reset URL
    // with its token — while both editors were missing.
    const STOPS = [
      '01. textbox "Message"',
      '02. link "Mention Alice"',
      "03. generic",
    ];
    // By default the stops are the same, each editor showing what it holds
    // (ADR-0001): the typed link is in the composer's value, not a stop.
    const { code, stdout } = await runCli(["tabs", COMPOSER_PAGE, "-q"]);
    expect(code).toBe(0);
    expect(stdout.trimEnd().replace(/ = ".*"$/gm, "")).toBe(STOPS.join("\n"));
    expect(stdout).toContain('03. generic = "my password is hunter2"');
    // --redact-input: no values, so neither the link nor the draft.
    const strict = await runCli([
      "tabs",
      COMPOSER_PAGE,
      "-q",
      "--redact-input",
    ]);
    expect(strict.stdout.trimEnd()).toBe(STOPS.join("\n"));
    expect(strict.stdout).not.toContain("token=abc123");
    expect(strict.stdout).not.toContain("hunter2");
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
 * Field values (ADR-0001): the live views print what each field holds, the way
 * a screen reader announces it; a sensitive field reads "[redacted]" and never
 * its bullets; `--redact-input` withholds every value; `snapshot` artifacts
 * carry values only with `--values`.
 *
 * The page fills its fields at runtime from split literals, so no sentinel is
 * in the data: URL (which stderr and the json envelope both echo).
 */
describe("field values (built bin)", () => {
  const FORM_PAGE = dataUrl(`<main><h1>Sign up</h1>
    <label>Email <input id="email" type="email"></label>
    <label>Password <input id="pw" type="password"></label>
    <label>Card <input id="cc" autocomplete="cc-number"></label>
    <label>Country <select><option>Spain</option><option selected>France</option></select></label>
    <script>
      document.getElementById("email").value = "VALUE-" + "email@example.com";
      document.getElementById("pw").value = "PW-" + "SENTINEL-1";
      document.getElementById("cc").value = "CC-" + "SENTINEL-4111";
    </script>
  </main>`);
  const SENSITIVE = /PW-SENTINEL|CC-SENTINEL|•/;

  it("tree prints each field's value, sensitive ones as [redacted]", async () => {
    for (const format of [[], ["-f", "json"]]) {
      const { code, stdout, stderr } = await runCli([
        "tree",
        FORM_PAGE,
        ...format,
      ]);
      expect(code).toBe(0);
      const tree =
        format.length > 0
          ? (JSON.parse(stdout) as { pages: { tree: string }[] }).pages[0].tree
          : stdout;
      expect(tree).toContain('textbox "Email" = "VALUE-email@example.com"');
      expect(tree).toContain('textbox "Password" = "[redacted]"');
      expect(tree).toContain('textbox "Card" = "[redacted]"');
      expect(tree).toContain('combobox "Country" = "France"');
      expect(stdout).not.toMatch(SENSITIVE);
      expect(stderr).not.toMatch(SENSITIVE);
    }
  });

  it("list and tabs print values too; audit never does", async () => {
    const list = await runCli(["list", "form", FORM_PAGE]);
    expect(list.stdout).toContain('= "VALUE-email@example.com"');
    const tabs = await runCli(["tabs", FORM_PAGE]);
    expect(tabs.stdout).toContain('= "VALUE-email@example.com"');
    expect(tabs.stdout).toContain('= "[redacted]"');
    const audit = await runCli(["audit", FORM_PAGE, "-f", "json"]);
    expect(audit.stdout).not.toContain("VALUE-email");
    for (const out of [list, tabs, audit]) {
      expect(out.stdout).not.toMatch(SENSITIVE);
    }
  });

  it("--redact-input (or defaults.redactInput) withholds every value", async () => {
    const flagged = await runCli(["tree", FORM_PAGE, "--redact-input"]);
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-redact-"));
    const config = join(dir, "a11y.config.json");
    writeFileSync(config, JSON.stringify({ defaults: { redactInput: true } }));
    const configured = await runCli(["tree", FORM_PAGE, "--config", config]);
    for (const { code, stdout } of [flagged, configured]) {
      expect(code).toBe(0);
      expect(stdout).toContain('textbox "Email"\n');
      expect(stdout).not.toContain(" = ");
      expect(stdout).not.toContain("VALUE-email");
      expect(stdout).not.toMatch(SENSITIVE);
    }
    const tabs = await runCli(["tabs", FORM_PAGE, "--redact-input"]);
    expect(tabs.stdout).not.toContain(" = ");
  });

  it("snapshot leaves values out of the artifact unless --values asks", async () => {
    const plain = await runCli(["snapshot", FORM_PAGE, "-q"]);
    expect(plain.code).toBe(0);
    expect(plain.stdout).not.toContain("VALUE-email");
    expect(plain.stdout).not.toContain(' = \\"');
    const plainArtifact = JSON.parse(plain.stdout) as {
      meta: { values?: boolean };
      pages: { tree: string }[];
    };
    expect(plainArtifact.meta.values).toBeUndefined();
    expect(plainArtifact.pages[0].tree).toContain('textbox "Email"');

    const withValues = await runCli(["snapshot", FORM_PAGE, "-q", "--values"]);
    const artifact = JSON.parse(withValues.stdout) as typeof plainArtifact;
    expect(artifact.meta.values).toBe(true);
    expect(artifact.pages[0].tree).toContain(
      'textbox "Email" = "VALUE-email@example.com"',
    );
    expect(artifact.pages[0].tree).toContain(
      'textbox "Password" = "[redacted]"',
    );
    expect(withValues.stdout).not.toMatch(SENSITIVE);

    // Strict mode wins over the opt-in.
    const strict = await runCli([
      "snapshot",
      FORM_PAGE,
      "-q",
      "--values",
      "--redact-input",
    ]);
    expect(strict.stdout).not.toContain("VALUE-email");
    expect(
      (JSON.parse(strict.stdout) as typeof plainArtifact).meta.values,
    ).toBeUndefined();
  });

  it("diff says why when only one side carries values", async () => {
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-values-diff-"));
    const base = join(dir, "base.json");
    const pr = join(dir, "pr.json");
    await runCli(["snapshot", FORM_PAGE, "-q", "-o", base]);
    await runCli(["snapshot", FORM_PAGE, "-q", "--values", "-o", pr]);
    const { stderr } = await runCli(["diff", base, pr]);
    expect(stderr).toContain("only the PR snapshot carries field values");
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
