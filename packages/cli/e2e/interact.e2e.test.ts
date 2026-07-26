/**
 * End-to-end: `interact` and the sugar verbs drive a real page through the
 * native action backend, then report the tree diff.
 *
 * Same conventions as cli.e2e.test.ts: spawn the BUILT bin (`pnpm build`
 * first) against data: URLs in real headless Chromium, Windows-safe execFile
 * of process.execPath.
 */

import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
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
    expect(res.stderr).toContain("--producer native");
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
    // …while still naming what to fix.
    expect(res.stderr).toContain("My Field");
  });

  it("rejects a malformed step before launching a browser", async () => {
    const res = await runCli(["interact", PAGE, "--step", "poke button"]);
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("unknown step verb");
    // Nothing was opened — the parse failure precedes the session.
    expect(res.stderr).not.toContain("opening");
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
