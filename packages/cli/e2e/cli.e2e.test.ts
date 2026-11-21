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

  it("audit reports a page without main as a warning: exit 0, exit 1 under --fail-on warning", async () => {
    const page = dataUrl("<div><h1>t</h1><p>x</p></div>");
    const byDefault = await runCli(["audit", page]);
    expect(byDefault.code).toBe(0);
    expect(byDefault.stdout).toContain("[warning] landmark-structure");
    const strict = await runCli(["audit", page, "--fail-on", "warning"]);
    expect(strict.code).toBe(1);
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

  it("reads a page nested past the CDP depth limit that DOM.getDocument cannot serialize", async () => {
    const page = dataUrl(
      "<!doctype html><title>Deep</title><main><h1>Deep page</h1>" +
        '<div id="root"></div><a href="#after">After the chain</a></main>' +
        "<script>let c=document.getElementById('root');" +
        "for(let i=0;i<160;i++){const d=document.createElement('div');c.appendChild(d);c=d}" +
        "const b=document.createElement('button');b.textContent='Deep button';c.appendChild(b);" +
        "</script>",
    );
    const tree = await runCli(["tree", page]);
    expect(tree.code).toBe(0);
    expect(tree.stdout).toContain('button "Deep button"');
    const audit = await runCli(["audit", page]);
    expect(audit.stdout + audit.stderr).not.toContain("page failed");
    expect(audit.stdout + audit.stderr).not.toContain("stack limit");
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
      [
        '01. link "Docs"',
        '02. button "Publish" {disabled}',
        '03. button "Unlock"',
      ].join("\n"),
    );
  });

  it("tabs lists an image map's areas where their map sits, as Chromium tabs to them", async () => {
    // Chromium's own Tab walk of this page, in 151 and 153. Since 153 its UA
    // stylesheet gives every <area> `display: none`, and the walk dropped them
    // all. An area follows its image instead: a stop while the image using
    // its map is rendered, at the area's own place in the document. The
    // unused map's area and the hidden image's are no stops. The GIF is a
    // valid 1x1 image; a truncated one left a broken image whose fallback
    // rendering varies by platform.
    const gif =
      "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    const img = (alt: string, usemap: string, attrs = "") =>
      `<img src="${gif}" width="10" height="10" alt="${alt}" usemap="${usemap}"${attrs}>`;
    const map = (name: string, alt: string) =>
      `<map name="${name}"><area href="/${name}" alt="${alt}" coords="0,0,10,10"></map>`;
    const page = dataUrl(
      "<!doctype html><title>Image map</title><main>" +
        "<button>Before</button>" +
        map("nav", "Home") +
        "<button>Middle</button>" +
        img("Site map", "#nav") +
        img("Old map", "#old", ' style="display: none"') +
        map("old", "Old home") +
        map("unused", "Unused") +
        "<button>After</button>" +
        "</main>",
    );
    const { code, stdout, stderr } = await runCli(["tabs", page, "-q"]);
    expect(code).toBe(0);
    // stderr in the message: if a stop goes missing on one platform only,
    // the failure should say what the CLI reported there.
    expect(stdout.trimEnd(), `stderr:\n${stderr}`).toBe(
      [
        '01. button "Before"',
        '02. link "Home"',
        '03. button "Middle"',
        '04. button "After"',
      ].join("\n"),
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
        '02. generic "Shipping" {expanded=false}',
        '03. generic "Returns" {expanded}',
        '04. generic "Warranty" {expanded=false}',
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

  it("--redact-input keeps editor text out of a tab stop's name, as tree does", async () => {
    // `tabs` is the in-page walk, so strict mode has to reach the DOM
    // producer's names, not only its values: a button named by an editor's
    // text, and a link around one, must read as `tree` reads them. The text
    // is written at runtime, so the data: URL that stderr echoes holds none.
    const PAGE = dataUrl(`<main>
      <div id="ed" contenteditable="true"></div>
      <button aria-labelledby="ed">Send</button>
      <a href="/next"><span class="s" contenteditable="true"></span></a>
      <script>
        const S = "EDITOR-" + "SECRET";
        document.getElementById("ed").textContent = S;
        document.querySelector(".s").textContent = S + " link";
      </script>
    </main>`);
    const shown = await runCli(["tabs", PAGE]);
    expect(shown.code).toBe(0);
    expect(shown.stdout).toContain('button "EDITOR-SECRET"');

    const strict = await runCli(["tabs", PAGE, "--redact-input"]);
    expect(strict.code).toBe(0);
    expect(strict.stdout).toContain('button "[redacted]"');
    expect(strict.stdout).toContain('link "[redacted]"');
    expect(strict.stdout).not.toContain("EDITOR-SECRET");
    expect(strict.stderr).not.toContain("EDITOR-SECRET");
    const tree = await runCli(["tree", PAGE, "--redact-input"]);
    expect(tree.stdout).toContain('button "[redacted]"');
    expect(tree.stdout).toContain('link "[redacted]"');
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
      .filter((stop) => !/^\S+ "(S|O)"(?: \{[^}]*\})?$/.test(stop));
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

  it("tabs reads a page whose named image shadows document.querySelector", async () => {
    // `<img name="querySelector">` IS `document.querySelector` on this page.
    // The in-page root lookup called it, and its catch reported the TypeError
    // as `Invalid rootSelector: "body"` — with no --root passed at all.
    const page = dataUrl(
      "<!doctype html><title>Shadowed</title><main>" +
        "<img name='querySelector' alt=''>" +
        "<label for='email'>Email</label><input id='email' type='email'>" +
        "</main>",
    );
    const { code, stdout, stderr } = await runCli(["tabs", page, "-q"]);
    expect(stderr).not.toContain("rootSelector");
    expect(code).toBe(0);
    expect(stdout.trimEnd()).toBe('01. textbox "Email"');
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

// The states block from Chromium's own tree, in a suite that gates CI: the
// browser package's real-Chromium cases run advisory.
describe("the states block (built bin)", () => {
  const linesOf = (stdout: string) => stdout.split("\n").map((l) => l.trim());

  it("tree prints each control's states from Chromium's tree", async () => {
    const page = dataUrl(
      "<!doctype html><title>States</title><main>" +
        '<input type="checkbox" checked aria-label="Subscribe">' +
        '<input type="checkbox" aria-label="Subscribe">' +
        '<button aria-expanded="false" aria-haspopup="menu">Menu</button>' +
        '<button aria-describedby="h">Pay</button><p id="h" hidden>Charged today</p>' +
        "</main>",
    );
    const { code, stdout } = await runCli(["tree", page, "-q"]);
    expect(code).toBe(0);
    const lines = linesOf(stdout);
    for (const line of [
      'checkbox "Subscribe" {checked}',
      'checkbox "Subscribe" {checked=false}',
      'button "Menu" {expanded=false, haspopup=menu}',
      'button "Pay" {description="Charged today"}',
    ]) {
      expect(lines).toContain(line);
    }
  });

  it("tree withholds a sensitive list box's selection, as a drop-down's", async () => {
    const page = dataUrl(
      "<!doctype html><title>Card</title><main>" +
        '<select aria-label="Month" autocomplete="cc-exp-month"><option>01</option><option selected>03</option></select>' +
        '<select aria-label="Year" autocomplete="cc-exp-year" size="3"><option>2027</option><option selected>2031</option><option>2032</option></select>' +
        '<select aria-label="Size" size="3"><option>S</option><option selected>M</option><option>L</option></select>' +
        "</main>",
    );
    const { code, stdout } = await runCli(["tree", page, "-q"]);
    expect(code).toBe(0);
    const lines = linesOf(stdout);
    expect(lines).toContain('option "03"');
    expect(lines).toContain('option "2031"');
    expect(stdout).not.toMatch(/option "(03|2031)" \{/);
    // An ordinary list box still says which option is selected.
    expect(lines).toContain('option "M" {selected}');
  });

  it("tree withholds the choice in a sensitive combobox's popup", async () => {
    // An ARIA combobox's popup listbox is not the field's descendant:
    // aria-controls reaches it, and so does aria-owns, which Chromium leaves
    // unreparented under an <input>. A closed popup that stays rendered keeps
    // its options in the tree, so it counts too.
    const option = (label: string, selected: boolean) =>
      `<li role="option" aria-selected="${selected}">${label}</li>`;
    const combobox = (
      label: string,
      attrs: string,
      expanded: boolean,
      options: string,
    ) =>
      `<input role="combobox" aria-label="${label}" aria-expanded="${expanded}" ${attrs}>` +
      `<ul role="listbox" id="${label}-list" aria-label="${label} options">${options}</ul>`;
    const page = dataUrl(
      "<!doctype html><title>Card</title><main>" +
        combobox(
          "Month",
          'autocomplete="cc-exp-month" aria-controls="Month-list"',
          true,
          // A hidden "selected" description only the chosen option carries.
          option("01", false) +
            '<li role="option" aria-selected="true" aria-describedby="month-sel">03' +
            '<span id="month-sel" hidden>selected</span></li>',
        ) +
        combobox(
          "Year",
          'autocomplete="cc-exp-year" aria-owns="Year-list"',
          true,
          option("2031", true) + option("2032", false),
        ) +
        combobox(
          "Expiry",
          'autocomplete="cc-exp" aria-controls="Expiry-list"',
          false,
          option("03/31", true),
        ) +
        combobox(
          "Color",
          'aria-controls="Color-list"',
          true,
          option("Red", true) + option("Blue", false),
        ) +
        // ARIA 1.1: the wrapper carries the relation for the field inside.
        '<div role="combobox" aria-expanded="true" aria-controls="Card-list">' +
        '<input aria-label="Card" autocomplete="cc-number"></div>' +
        '<ul role="listbox" id="Card-list" aria-label="Cards">' +
        option("Visa 1111", true) +
        "</ul>" +
        // ARIA 1.1 with no relation: the wrapper holds its listbox as a child.
        // Chromium relates the textbox inside to it (`controls`) on its own.
        '<div role="combobox" aria-expanded="true" aria-label="Saved card wrapper">' +
        '<input aria-label="Saved card" autocomplete="cc-number" value="4111" readonly>' +
        '<ul role="listbox" aria-label="Saved cards">' +
        option("Visa 4242", true) +
        "</ul></div></main>",
    );
    const { code, stdout } = await runCli(["tree", page, "-q"]);
    expect(code).toBe(0);
    const lines = linesOf(stdout);
    for (const label of [
      "01",
      "03",
      "2031",
      "2032",
      "03/31",
      "Visa 1111",
      "Visa 4242",
    ]) {
      expect(lines).toContain(`option "${label}"`);
    }
    expect(stdout).not.toMatch(
      /option "(01|03|2031|2032|03\/31|Visa 1111|Visa 4242)" \{/,
    );
    // An ordinary combobox's popup still says which option is selected.
    expect(lines).toContain('option "Red" {selected}');
  });

  it("tree withholds a sensitive popup's choice from a name built around it", async () => {
    // A label around the field and its listbox lends the chosen option, as a
    // field's value: Chromium names the combobox "Expiry month 03".
    const labelled = (label: string, attrs: string, selected: boolean) =>
      `<label>${label} <input role="combobox" aria-expanded="true" aria-controls="${label}-list" ${attrs}>` +
      `<ul role="listbox" id="${label}-list"><li role="option" aria-selected="${selected}">03</li></ul></label>`;
    const page = dataUrl(
      "<!doctype html><title>Card</title><main>" +
        labelled("Month", 'autocomplete="cc-exp-month"', true) +
        // Nothing chosen lends nothing; an ordinary field's popup is the page's.
        labelled("Year", 'autocomplete="cc-exp-year"', false) +
        labelled("Color", "", true) +
        "</main>",
    );
    const { code, stdout } = await runCli(["tree", page, "-q"]);
    expect(code).toBe(0);
    const lines = linesOf(stdout);
    expect(lines).toContain(
      'combobox "[redacted]" {expanded, haspopup=listbox}',
    );
    expect(lines).toContain('combobox "Year" {expanded, haspopup=listbox}');
    expect(lines).toContain('combobox "Color 03" {expanded, haspopup=listbox}');
    expect(stdout).not.toContain("Month 03");
  });

  it("withholds a sensitive field's choice wherever its popup sits, in both producers", async () => {
    const chosen = (label: string) =>
      `<li role="option" aria-selected="true">${label}</li>`;
    const listbox = (id: string, options: string) =>
      `<ul role="listbox" id="${id}">${options}</ul>`;
    const wrapper = (inside: string) =>
      `<div role="combobox" aria-expanded="true">${inside}</div>`;
    const card = (n: number, attrs = "") =>
      `<input aria-label="Card ${n}" autocomplete="cc-number" ${attrs}>`;
    const page = dataUrl(
      "<!doctype html><title>Card</title><main>" +
        // ARIA 1.1 wrappers with no relation, in the shapes Chromium relates
        // nothing for: the field a level down, a button between, a label
        // around it, a search field, the listbox first, a second listbox.
        wrapper(`<div>${card(1)}</div>` + listbox("lb1", chosen("Visa 1001"))) +
        wrapper(
          card(2) +
            `<button aria-label="Open">v</button>` +
            listbox("lb2", chosen("Visa 1002")),
        ) +
        wrapper(
          `<label>Card 3 <input autocomplete="cc-number"></label>` +
            listbox("lb3", chosen("Visa 1003")),
        ) +
        wrapper(
          card(4, 'type="search"') + listbox("lb4", chosen("Visa 1004")),
        ) +
        wrapper(listbox("lb5", chosen("Visa 1005")) + card(5)) +
        wrapper(
          card(6) +
            listbox("lb6", chosen("Visa 1006")) +
            listbox("lb7", chosen("Visa 1007")),
        ) +
        // aria-controls naming a wrapper Chromium leaves out: it reports the
        // relation with no target, so only the DOM walk finds the listbox.
        `<input role="combobox" aria-label="Card 8" autocomplete="cc-number" aria-controls="p8" aria-expanded="true">` +
        `<div id="p8" role="presentation">${listbox("lb8", chosen("Visa 1008"))}</div>` +
        // Reached only by aria-activedescendant.
        `<input role="combobox" aria-label="Month" autocomplete="cc-exp-month" aria-activedescendant="o9" aria-expanded="true">` +
        listbox(
          "lb9",
          '<li role="option" aria-selected="false">01</li>' +
            '<li role="option" id="o9" aria-selected="true">09</li>',
        ) +
        // A multi-row select, its own popup.
        '<h2>Expires <select id="y" size="3" autocomplete="cc-exp-year">' +
        "<option>2027</option><option selected>2031</option></select></h2>" +
        '<button aria-labelledby="y"></button><button aria-describedby="y">Pay</button>' +
        // Descriptions the chosen option, or another, carries from anywhere.
        `<input role="combobox" aria-label="Year" autocomplete="cc-exp-year" aria-controls="lbd" aria-expanded="true">` +
        listbox(
          "lbd",
          '<li role="option" aria-selected="true" aria-describedby="dsel">2033</li>' +
            '<li role="option" aria-selected="false" aria-description="selected">2034</li>' +
            '<li role="option" aria-selected="false" title="current choice">2035</li>',
        ) +
        '<span id="dsel" hidden>selected</span>' +
        // An ordinary wrapper keeps its choice.
        wrapper('<input aria-label="Color">' + listbox("lbc", chosen("Red"))) +
        "<section>" +
        [1, 2, 3, 4, 5, 6, 7, 8, 9]
          .map((n) => `<button aria-labelledby="lb${n}"></button>`)
          .join("") +
        "</section></main>",
    );
    const tree = await runCli(["tree", page, "-q"]);
    expect(tree.code).toBe(0);
    const lines = linesOf(tree.stdout);
    for (let n = 1; n <= 8; n++)
      expect(lines).toContain(`option "Visa 100${n}"`);
    expect(lines).toContain('option "09"');
    expect(tree.stdout).not.toMatch(
      /option "(Visa 100\d|0[19]|20(2[78]|3[1-5]))" \{/,
    );
    expect(lines).toContain('option "Red" {selected}');
    expect(lines).toContain('heading "[redacted]" (level 2)');
    expect(lines).toContain('button "Pay"');
    expect(lines.filter((l) => l === 'button "[redacted]"')).toHaveLength(10);
    expect(tree.stdout).not.toContain("description=");
    expect(tree.stdout).not.toMatch(/button "(Visa|2031)/);

    const tabs = await runCli(["tabs", page, "-q"]);
    expect(tabs.code).toBe(0);
    expect(tabs.stdout.match(/button "\[redacted\]"/g)).toHaveLength(10);
    expect(tabs.stdout).toMatch(/\d\d\. button "Pay"\n/);
    expect(tabs.stdout).not.toContain("description=");
  });

  it("withholds a sensitive popup's choice marked by checked, pressed or current, in both producers", async () => {
    // Focusable items, so the in-page tree (`tabs`) shows them too.
    const item = (role: string, label: string, attrs: string, id = "") =>
      `<div role="${role}" tabindex="0" ${id ? `id="${id}"` : ""} ${attrs}>${label}</div>`;
    const field = (label: string, popup: string, attrs = "") =>
      `<input role="combobox" aria-label="${label}" autocomplete="cc-exp" aria-expanded="true" aria-controls="${popup}" ${attrs}>`;
    const page = dataUrl(
      "<!doctype html><title>Expiry</title><main>" +
        // A menu of radio and check items.
        field("Menu", "m", 'aria-haspopup="menu"') +
        `<div role="menu" id="m" aria-label="Dates">` +
        item("menuitemradio", "01/30", 'aria-checked="false"') +
        item("menuitemradio", "03/31", 'aria-checked="true"', "mpick") +
        item("menuitemcheckbox", "Save", 'aria-checked="true"') +
        "</div>" +
        // A listbox whose page marks the choice with aria-checked.
        field("List", "l") +
        `<div role="listbox" id="l" aria-label="Months">` +
        item("option", "04/32", 'aria-checked="true"', "lpick") +
        item("option", "05/33", 'aria-current="true"') +
        "</div>" +
        // A date picker's pressed day.
        field("Grid", "g", 'aria-haspopup="grid"') +
        `<div role="grid" id="g" aria-label="Days"><div role="row">` +
        `<div role="gridcell"><button aria-pressed="true">Day 7</button></div>` +
        `<div role="gridcell"><button aria-pressed="false">Day 8</button></div></div></div>` +
        // Radios in a dialog popup, beside a checkbox of its own.
        field("Dialog", "d", 'aria-haspopup="dialog"') +
        `<div role="dialog" id="d" aria-label="Pick">` +
        `<label><input type="radio" name="y" checked> 2041</label>` +
        `<label><input type="radio" name="y"> 2042</label>` +
        `<label><input type="checkbox" checked> Remember</label></div>` +
        // Reached only by aria-activedescendant: the active item isn't the chosen one.
        `<input role="combobox" aria-label="Active" autocomplete="cc-exp" aria-expanded="true" aria-activedescendant="a1">` +
        `<div role="menu" aria-label="Active dates">` +
        item("menuitemradio", "06/34", 'aria-checked="false"', "a1") +
        item("menuitemradio", "07/35", 'aria-checked="true"') +
        "</div>" +
        // Names that read the chosen item.
        '<button aria-labelledby="mpick"></button><button aria-labelledby="lpick"></button>' +
        // An ordinary field's menu keeps its choice.
        `<input role="combobox" aria-label="Color" aria-expanded="true" aria-controls="c">` +
        `<div role="menu" id="c" aria-label="Colors">${item("menuitemradio", "Red", 'aria-checked="true"')}</div>` +
        "</main>",
    );
    const leaked = (out: string) =>
      out
        .split("\n")
        .filter((line) =>
          /"(0[1-7]\/3[0-5]|Save|Day [78]|204[12])".*\{/.test(line),
        );

    const tree = await runCli(["tree", page, "-q"]);
    expect(tree.code).toBe(0);
    const lines = linesOf(tree.stdout);
    expect(lines).toContain('menuitemradio "03/31"');
    expect(lines).toContain('option "04/32"');
    expect(lines).toContain('button "Day 7"');
    expect(lines).toContain('radio "2041"');
    expect(lines).toContain('menuitemradio "07/35"');
    expect(leaked(tree.stdout)).toEqual([]);
    expect(lines.filter((l) => l === 'button "[redacted]"')).toHaveLength(2);
    // A checkbox is its own control; an ordinary menu keeps its choice.
    expect(lines).toContain('checkbox "Remember" {checked}');
    expect(lines).toContain('menuitemradio "Red" {checked}');

    const tabs = await runCli(["tabs", page, "-q"]);
    expect(tabs.code).toBe(0);
    expect(tabs.stdout).toMatch(/\d\d\. menuitemradio "03\/31"\n/);
    expect(tabs.stdout).toMatch(/\d\d\. option "05\/33"\n/);
    expect(tabs.stdout).toMatch(/\d\d\. radio "2041"\n/);
    expect(leaked(tabs.stdout)).toEqual([]);
    expect(tabs.stdout).toMatch(/\d\d\. checkbox "Remember" \{checked\}/);
    expect(tabs.stdout).toMatch(/\d\d\. menuitemradio "Red" \{checked\}/);
  });

  it("a title that repeats a link's text describes it in neither producer", async () => {
    const page = dataUrl(
      "<!doctype html><title>Outline</title><main>" +
        '<a href="#a" title="See also">See also</a>' +
        '<a href="#c" title="Trailing ">Trailing</a>' +
        '<a href="#b" title="More detail">Details</a>' +
        "</main>",
    );
    const tree = await runCli(["tree", page, "-q"]);
    const tabs = await runCli(["tabs", page, "-q"]);
    expect(linesOf(tree.stdout)).toContain('link "See also"');
    expect(tabs.stdout).toContain('01. link "See also"\n');
    // Whitespace at a title's ends doesn't make it say something else.
    expect(linesOf(tree.stdout)).toContain('link "Trailing"');
    expect(tabs.stdout).toContain('02. link "Trailing"\n');
    // A title that says something else still describes, in both.
    expect(linesOf(tree.stdout)).toContain(
      'link "Details" {description="More detail"}',
    );
    expect(tabs.stdout).toContain(
      '03. link "Details" {description="More detail"}',
    );
  });

  it("pins where the producers differ on a pristine required checkbox", async () => {
    // Chromium reports a required checkbox invalid from the start and carries
    // no `required` for it; the DOM producer reads `required` from the element
    // and waits for :user-invalid, as HTML-AAM says. The docs list it.
    const page = dataUrl(
      "<!doctype html><title>Terms</title><main><form>" +
        '<input type="checkbox" required aria-label="I agree">' +
        "</form></main>",
    );
    const tree = await runCli(["tree", page, "-q"]);
    const tabs = await runCli(["tabs", page, "-q"]);
    expect(linesOf(tree.stdout)).toContain(
      'checkbox "I agree" {checked=false, invalid}',
    );
    expect(tabs.stdout.trimEnd()).toBe(
      '01. checkbox "I agree" {checked=false, required}',
    );
  });

  describe("--no-states", () => {
    const PAGE = dataUrl(
      "<!doctype html><title>Opt out</title><main>" +
        '<input type="checkbox" checked aria-label="Subscribe">' +
        '<button aria-expanded="false">Menu</button>' +
        "</main>",
    );
    const stripBlocks = (text: string) => text.replace(/ \{[^}]*\}/g, "");

    it("leaves the blocks out of tree, tabs and inspect, and nothing else", async () => {
      for (const command of ["tree", "tabs"]) {
        const on = await runCli([command, PAGE, "-q"]);
        const off = await runCli([command, PAGE, "-q", "--no-states"]);
        expect(off.code, command).toBe(0);
        expect(on.stdout, command).toContain('"Subscribe" {checked}');
        expect(off.stdout, command).not.toContain("{");
        // The default's text with its blocks taken out, byte for byte.
        expect(off.stdout, command).toBe(stripBlocks(on.stdout));
      }
      const json = await runCli([
        "tree",
        PAGE,
        "-q",
        "--no-states",
        "--format",
        "json",
      ]);
      expect(json.stdout).toContain('checkbox \\"Subscribe\\"');
      expect(json.stdout).not.toContain("{checked");
      const inspect = await runCli(["inspect", PAGE, "-q", "--no-states"]);
      expect(inspect.stdout).toContain('checkbox "Subscribe"');
      expect(inspect.stdout).not.toContain("{checked");
      expect((await runCli(["inspect", PAGE, "-q"])).stdout).toContain(
        'checkbox "Subscribe" {checked}',
      );
    });

    it("snapshot records the choice, and diff says why a mixed pair churns", async () => {
      const dir = mkdtempSync(join(tmpdir(), "real-a11y-states-"));
      const withBlocks = join(dir, "with.json");
      const without = join(dir, "without.json");
      expect(
        (await runCli(["snapshot", PAGE, "-q", "-o", withBlocks])).code,
      ).toBe(0);
      expect(
        (await runCli(["snapshot", PAGE, "-q", "--no-states", "-o", without]))
          .code,
      ).toBe(0);
      type Artifact = { meta: { states?: boolean }; pages: { tree: string }[] };
      const on = JSON.parse(readFileSync(withBlocks, "utf8")) as Artifact;
      const off = JSON.parse(readFileSync(without, "utf8")) as Artifact;
      expect(on.meta.states).toBe(true);
      expect(on.pages[0]!.tree).toContain('checkbox "Subscribe" {checked}');
      expect(off.meta.states).toBeUndefined();
      expect(off.pages[0]!.tree).toBe(stripBlocks(on.pages[0]!.tree));

      const mixed = await runCli(["diff", without, withBlocks]);
      expect(mixed.stderr).toContain(
        "only the PR snapshot carries {…} states blocks",
      );
      const alike = await runCli(["diff", withBlocks, withBlocks]);
      expect(alike.stderr).not.toContain("states blocks");
      // A findings-only report holds no tree line for the warning to explain.
      const findingsOnly = await runCli([
        "diff",
        without,
        withBlocks,
        "--only",
        "findings",
      ]);
      expect(findingsOnly.stderr).not.toContain("states blocks");

      // Nor does a pair with no page in common, which compares no tree line.
      const elsewhere = join(dir, "elsewhere.json");
      await runCli([
        "snapshot",
        dataUrl(
          "<!doctype html><title>Other</title><main><h1>Other</h1></main>",
        ),
        "-q",
        "--no-states",
        "--values",
        "-o",
        elsewhere,
      ]);
      const disjoint = await runCli(["diff", elsewhere, withBlocks]);
      expect(disjoint.stderr).toContain("no pages matched");
      expect(disjoint.stderr).not.toContain("states blocks");
      expect(disjoint.stderr).not.toContain("carries field values");

      // A findings-only artifact keeps no tree, so it records neither blocks
      // nor values.
      const partial = await runCli([
        "snapshot",
        PAGE,
        "-q",
        "--values",
        "--only",
        "findings",
        "--format",
        "json",
      ]);
      const partialArtifact = JSON.parse(partial.stdout) as Artifact & {
        meta: { values?: boolean };
      };
      expect(partialArtifact.pages[0]!.tree).toBe("");
      expect(partialArtifact.meta.states).toBeUndefined();
      expect(partialArtifact.meta.values).toBeUndefined();
    });

    it("an outage on one side reads as neither blocks nor a mixed pair", async () => {
      // Nothing listens on port 9 here, so the page fails to open and no
      // tree is written: the artifact records no blocks.
      type Meta = {
        meta: { states?: boolean };
        pages: { status: string; tree: string }[];
      };
      const down = JSON.parse(
        (await runCli(["snapshot", "http://127.0.0.1:9/", "-q"])).stdout,
      ) as Meta;
      expect(down.pages[0]!.status).toBe("error");
      expect(down.meta.states).toBeUndefined();

      // A base whose page failed, against a healthy capture of the same page:
      // the pair joins, but no tree line is compared, so neither warning.
      const dir = mkdtempSync(join(tmpdir(), "real-a11y-states-outage-"));
      const healthy = join(dir, "healthy.json");
      await runCli(["snapshot", PAGE, "-q", "--values", "-o", healthy]);
      const artifact = JSON.parse(readFileSync(healthy, "utf8")) as {
        meta: Record<string, unknown>;
        pages: Record<string, unknown>[];
      };
      const failed = join(dir, "failed.json");
      writeFileSync(
        failed,
        JSON.stringify({
          ...artifact,
          meta: { ...artifact.meta, states: undefined, values: undefined },
          pages: artifact.pages.map((page) => ({
            ...page,
            status: "error",
            error: "could not open",
            findings: [],
            tree: "",
            outline: "",
          })),
        }),
      );
      const { stderr } = await runCli(["diff", failed, healthy]);
      expect(stderr).not.toContain("states blocks");
      expect(stderr).not.toContain("carries field values");
    });

    it("a config's defaults.states: false opts out too", async () => {
      const dir = mkdtempSync(join(tmpdir(), "real-a11y-states-config-"));
      const config = join(dir, "a11y.config.json");
      writeFileSync(config, JSON.stringify({ defaults: { states: false } }));
      const { code, stdout } = await runCli([
        "tree",
        PAGE,
        "-q",
        "--config",
        config,
      ]);
      expect(code).toBe(0);
      expect(linesOf(stdout)).toContain('checkbox "Subscribe"');
      expect(stdout).not.toContain("{");
    });
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

  it("tree keeps a hidden card field's number out of the name it gives", async () => {
    // Chromium ignores an aria-hidden field and sends no value for it, yet
    // still names the region it labels after the card. With nothing to tell
    // it holds anything, the field withholds that name (core's
    // givesValueAway), while a password's own label still names it.
    const page = dataUrl(`<main><h1>Saved</h1>
      <input id="hidden-cc" aria-hidden="true" autocomplete="cc-number">
      <section aria-labelledby="hidden-cc">Saved card</section>
      <label>Password <input id="pw" type="password"></label>
      <script>
        document.getElementById("hidden-cc").value = "CC-" + "SENTINEL-3782";
        document.getElementById("pw").value = "PW-" + "SENTINEL-1";
      </script>
    </main>`);
    const { code, stdout, stderr } = await runCli(["tree", page]);
    expect(code).toBe(0);
    expect(stdout).toContain('region "[redacted]"');
    expect(stdout).toContain('textbox "Password" = "[redacted]"');
    expect(stdout).not.toMatch(SENSITIVE);
    expect(stderr).not.toMatch(SENSITIVE);
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
