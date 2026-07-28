/**
 * End-to-end: `interact` and the sugar verbs drive a real page through the
 * native action backend, then report the tree diff.
 *
 * Same conventions as cli.e2e.test.ts: spawn the BUILT bin (`pnpm build`
 * first) against data: URLs in real headless Chromium, Windows-safe execFile
 * of process.execPath.
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

function runCli(args: string[]): Promise<RunResult> {
  return new Promise((resolvePromise) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      {
        env: {
          ...process.env,
          NO_COLOR: "1",
          FORCE_COLOR: "",
          GITHUB_ACTIONS: "",
          REAL_A11Y_MCP_ALLOW_FILE: "",
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

// Each control reports its outcome into a heading, so the a11y tree diff —
// not a screenshot or an innerHTML peek — is what proves the action landed.
const PAGE = dataUrl(`<main>
  <h1>Fixture</h1>
  <button onclick="document.getElementById('out').textContent='menu open'">Open menu</button>
  <h2 id="out">menu closed</h2>
  <input aria-label="Email" oninput="document.getElementById('echo').textContent='typed '+this.value.length+' chars'">
  <h3 id="echo">nothing typed</h3>
  <button>Save</button>
  <button>Save</button>
  <button disabled>Locked</button>
</main>`);

const SECRET = "hunter2-lives-here"; // 18 chars — the page echoes the length

describe("real-a11y interact", () => {
  it("runs a step and reports what it changed for a screen reader", async () => {
    const res = await runCli([
      "interact",
      PAGE,
      "--step",
      'click button "Open menu"',
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('heading "menu open"');
    expect(res.stdout).toContain('"menu closed" → "menu open"');
  });

  it("runs multiple steps in order", async () => {
    const res = await runCli([
      "interact",
      PAGE,
      "--step",
      `type textbox "Email" = ${SECRET}`,
      "--step",
      'click button "Open menu"',
    ]);
    expect(res.code).toBe(0);
    // Both effects are visible in one diff.
    expect(res.stdout).toContain('"menu closed" → "menu open"');
    expect(res.stdout).toContain("typed 18 chars");
  });

  it("delivers the typed value to the page but never echoes it (R1)", async () => {
    const res = await runCli([
      "interact",
      PAGE,
      "--step",
      `type textbox "Email" = ${SECRET}`,
    ]);
    expect(res.code).toBe(0);
    // It reached the page — the input handler counted 18 characters …
    expect(res.stdout).toContain("typed 18 chars");
    // … but the value itself appears in NO stream, and the step echo is masked.
    expect(res.stdout).not.toContain("hunter2");
    expect(res.stderr).not.toContain("hunter2");
    expect(res.stderr).toContain("‹hidden›");
  });

  it("keeps the typed value out of --format json too", async () => {
    const res = await runCli([
      "interact",
      PAGE,
      "-q",
      "-f",
      "json",
      "--step",
      `type textbox "Email" = ${SECRET}`,
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("hunter2");
    const payload = JSON.parse(res.stdout) as {
      command: string;
      pages: { steps: string[]; diff: string }[];
    };
    expect(payload.command).toBe("interact");
    expect(payload.pages[0].steps).toEqual(['type textbox "Email" = ‹hidden›']);
    expect(payload.pages[0].diff).toContain("typed 18 chars");
  });

  it("lists nth= candidates when a target is ambiguous", async () => {
    const res = await runCli([
      "interact",
      PAGE,
      "--step",
      'click button "Save"',
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('2 nodes match button "Save"');
    expect(res.stderr).toContain("nth=1");
    expect(res.stderr).toContain("nth=2");
  });

  it("acts on the right one once nth= picks it", async () => {
    const res = await runCli([
      "interact",
      PAGE,
      "--step",
      'click button "Save" nth=2',
    ]);
    expect(res.code).toBe(0);
  });

  it("refuses a disabled target instead of reporting an empty diff", async () => {
    // The dangerous alternative: el.click() on a disabled control "succeeds"
    // and changes nothing, so success + an empty diff would read as "that
    // button does nothing" rather than "you can't click it".
    const res = await runCli([
      "interact",
      PAGE,
      "--step",
      'click button "Locked"',
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("is disabled");
  });

  it("explains a miss in the tree's own vocabulary", async () => {
    const res = await runCli([
      "interact",
      PAGE,
      "--step",
      'click button "Nope"',
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain('no button "Nope"');
    // The hint must be a command that actually RUNS. It used to say
    // `real-a11y tree <url> --producer native`, which now exits 2 with
    // "Unknown option" — recovery advice that fails is worse than none.
    expect(res.stderr).toContain("real-a11y tree <url>");
    expect(res.stderr).not.toContain("--producer");
  });

  it("masks the value when a type step is malformed (R1 on the failure path)", async () => {
    // The parse error quotes the offending input to make it fixable, but a
    // malformed `type` step still carries its value — and this is the stream
    // CI captures. Unquoted multi-word name: the value must not survive.
    const res = await runCli([
      "interact",
      PAGE,
      "--step",
      `type textbox My Field = ${SECRET}`,
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).not.toContain("hunter2");
    expect(res.stdout).not.toContain("hunter2");
    expect(res.stderr).toContain("‹hidden›");
    // Nothing of the step's text survives — not even the unquoted name, since
    // the parser can't tell a name from a value once the step is malformed.
    expect(res.stderr).not.toContain("My Field");
    // The hint carries the fix instead of the echo.
    expect(res.stderr).toContain("quote the name and introduce the value");
  });

  it("masks the value when the `=` separator is forgotten entirely", async () => {
    // The likelier typo: with no separator the value is just an unparsed
    // token, indistinguishable from a name the user forgot to quote — so the
    // whole remainder is masked and the hint carries the fix instead.
    const res = await runCli([
      "interact",
      PAGE,
      "--step",
      `type textbox "Password" ${SECRET}`,
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).not.toContain("hunter2");
    expect(res.stdout).not.toContain("hunter2");
    expect(res.stderr).toContain("‹hidden›");
    expect(res.stderr).toContain("quote the name and introduce the value");
  });

  it("masks a base64 value whose own `=` padding defeated the old rule", async () => {
    // The regression that broke two earlier fixes: masking "from the first `=`"
    // treats the value's own padding as the separator, so the whole secret
    // survived into stderr. Nothing of it may appear now.
    const res = await runCli([
      "interact",
      PAGE,
      "--step",
      `type textbox "Password" ${SECRET}=`,
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).not.toContain("hunter2");
    expect(res.stdout).not.toContain("hunter2");
    expect(res.stderr).toContain("‹hidden›");
  });

  it("rejects a malformed step before launching a browser", async () => {
    const res = await runCli(["interact", PAGE, "--step", "poke button"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("unknown step verb");
    // Nothing was opened — the parse failure precedes the session.
    expect(res.stderr).not.toContain("opening");
  });

  it("reports where a navigating step LANDED, and flags the navigation", async () => {
    // `url` is contracted as the final address. Capturing it before the steps
    // ran made it the address the run *opened*, which is wrong in exactly the
    // case the report calls out as a navigation.
    //
    // Real files, not data: URLs — Chromium refuses top-level navigation TO a
    // data: URL, so a link between two of them never navigates and the case
    // under test would silently not happen.
    const dir = mkdtempSync(join(tmpdir(), "real-a11y-nav-"));
    writeFileSync(
      join(dir, "landing.html"),
      "<!doctype html><title>landing</title><main><h1>Landed</h1></main>",
    );
    writeFileSync(
      join(dir, "start.html"),
      '<!doctype html><title>start</title><main><a href="landing.html">Go</a></main>',
    );

    const res = await runCli([
      "interact",
      `file://${join(dir, "start.html")}`,
      "--allow-file",
      "-q",
      "-f",
      "json",
      "--step",
      'click link "Go"',
    ]);
    expect(res.code).toBe(0);
    const page = (
      JSON.parse(res.stdout) as {
        pages: { url: string; navigated?: boolean; diff: string }[];
      }
    ).pages[0];
    expect(page.navigated).toBe(true);
    expect(page.diff).toContain("navigated");
    // The reported address is where it landed, not where the run opened.
    expect(page.url).toContain("landing.html");
    expect(page.url).not.toContain("start.html");
  });

  it("leaves the reported url alone when nothing navigated", async () => {
    const res = await runCli([
      "interact",
      PAGE,
      "-q",
      "-f",
      "json",
      "--step",
      'click button "Open menu"',
    ]);
    expect(res.code).toBe(0);
    const page = (
      JSON.parse(res.stdout) as {
        pages: { url: string; navigated?: boolean }[];
      }
    ).pages[0];
    expect(page.navigated).toBe(false);
    expect(page.url).toBe(PAGE);
  });
});

describe("real-a11y click / type / focus", () => {
  it("click is a one-step interact", async () => {
    const res = await runCli([
      "click",
      PAGE,
      "-q",
      "--role",
      "button",
      "--name",
      "Open menu",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('"menu closed" → "menu open"');
  });

  it("focus reports the focus move", async () => {
    const res = await runCli([
      "focus",
      PAGE,
      "-q",
      "--role",
      "textbox",
      "--name",
      "Email",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("focus:");
    expect(res.stdout).toContain('textbox "Email"');
  });

  it("type delivers the value without echoing it", async () => {
    const res = await runCli([
      "type",
      PAGE,
      "-q",
      "--role",
      "textbox",
      "--name",
      "Email",
      "--text",
      SECRET,
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain("typed 18 chars");
    expect(res.stdout).not.toContain("hunter2");
  });

  it("rejects --text on click by name, not with a parser wall", async () => {
    const res = await runCli([
      "click",
      PAGE,
      "--role",
      "button",
      "--text",
      "nope",
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("--text applies to `type`");
  });

  it("requires --role", async () => {
    const res = await runCli(["click", PAGE]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("click needs --role");
  });
});

describe("real-a11y interact --step-settle", () => {
  // A step's effect isn't always there when the dispatch returns. This page
  // defers BOTH kinds of reaction past the click handler, so an immediate read
  // reports "no changes" for a click that plainly did something — the exact
  // case the flag exists for.
  const DEFERRED = dataUrl(`<main>
    <h1>Deferred</h1>
    <button id="later">Later</button>
    <div id="panel"></div>
    <script>
      later.onclick = () => setTimeout(() => {
        panel.innerHTML = '<h2>arrived late</h2>';
      }, 250);
    </script>
  </main>`);

  it("waits long enough to see a reaction that lands after the click", async () => {
    const res = await runCli([
      "click",
      DEFERRED,
      "--role",
      "button",
      "--name",
      "Later",
      "--step-settle",
      "600",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).toContain('heading "arrived late"');
  });

  it("misses it with --step-settle 0 — proof the wait is what does the work", async () => {
    // Pinning the negative keeps the flag honest: if the default ever stopped
    // being applied, the test above could pass for the wrong reason.
    const res = await runCli([
      "click",
      DEFERRED,
      "--role",
      "button",
      "--name",
      "Later",
      "--step-settle",
      "0",
    ]);
    expect(res.code).toBe(0);
    expect(res.stdout).not.toContain("arrived late");
  });

  it("rejects a bad value before launching a browser", async () => {
    const res = await runCli([
      "click",
      DEFERRED,
      "--role",
      "button",
      "--name",
      "Later",
      "--step-settle",
      "soon",
    ]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("--step-settle");
    expect(res.stderr).not.toContain("opening");
  });
});
