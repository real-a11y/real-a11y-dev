/**
 * End-to-end: `real-a11y timeline start|stop` on a `--session`, through the
 * built CLI and its daemon, in a real Chromium (ADR-0002).
 *
 * The delete-draft flow of the ticket: start a timeline, act with `click`,
 * stop, and read the lines. Also what a navigation, `--format json`, the
 * config's `redact` patterns and `--redact-input` do to the output.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

const BIN = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../dist/index.js",
);

function runCli(
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(
      process.execPath,
      [BIN, ...args],
      { env: { ...process.env, NO_COLOR: "1" }, timeout: 30_000 },
      (err, stdout, stderr) => {
        if (err && (err as { code?: unknown }).code === undefined) {
          reject(err);
          return;
        }
        resolve({
          code: (err?.code as number | undefined) ?? 0,
          stdout,
          stderr,
        });
      },
    );
  });
}

// The click moves focus off the deleted draft's button, which goes away,
// says so, then lands focus on the next control.
const DRAFTS = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Drafts</title></head>
<body>
<main>
  <ul><li id="draft">Draft 1 <button id="del">Delete draft</button></li></ul>
  <button id="new">New draft</button>
  <a href="next.html">Next page</a>
  <p role="status" id="status"></p>
</main>
<div contenteditable="true" id="note" aria-live="polite"></div>
<button id="edit" onclick="document.getElementById('note').textContent = 'token 1234 typed'">Fill note</button>
<script>
  document.getElementById("del").addEventListener("click", async () => {
    const status = document.getElementById("status");
    status.textContent = "Deleting…";
    await new Promise((r) => setTimeout(r, 20));
    document.getElementById("draft").remove();
    await new Promise((r) => setTimeout(r, 20));
    document.getElementById("new").focus();
    status.textContent = "Draft deleted.";
  });
</script>
</body></html>`;

describe("real-a11y timeline", () => {
  const dir = mkdtempSync(join(tmpdir(), "real-a11y-timeline-"));
  const url = `file://${join(dir, "drafts.html")}`;
  const name = `timeline-${process.pid}`;
  const base = ["--session", name, "--allow-file", "--no-config", "-q"];

  beforeAll(() => {
    writeFileSync(join(dir, "drafts.html"), DRAFTS);
    writeFileSync(
      join(dir, "next.html"),
      `<!doctype html><title>Next</title><main><h1>Next</h1></main>`,
    );
  });
  afterAll(async () => {
    await runCli(["session", "stop", name, "--quiet"]);
  });

  const click = (role: string, label: string, extra: string[] = []) =>
    runCli(["click", url, ...base, ...extra, "--role", role, "--name", label]);

  it("records the delete-draft flow between commands", async () => {
    const start = await runCli([
      "timeline",
      "start",
      url,
      ...base,
      "--root",
      "main",
    ]);
    expect(start.code).toBe(0);
    expect(start.stdout).toBe("");
    expect((await click("button", "Delete draft")).code).toBe(0);
    const stop = await runCli(["timeline", "stop", ...base]);
    expect(stop.code).toBe(0);
    // The CLI's `click` dispatches a pointer sequence over CDP without
    // moving focus to the button, so the first line is the status, not
    // `focus button "Delete draft"`. No producer header: ADR-0002 fixes it.
    expect(stop.stdout).toBe(
      [
        'announce  status "Deleting…"',
        'focus     button "New draft"',
        'announce  status "Draft deleted."',
        "",
      ].join("\n"),
    );
  }, 90_000);

  it("keeps what came before a navigation, and says so", async () => {
    expect(
      (await runCli(["timeline", "start", url, ...base, "--root", "main"]))
        .code,
    ).toBe(0);
    // A real focus move first, so there is a known line from before the
    // navigation to look for afterwards.
    const focus = await runCli([
      "focus",
      url,
      ...base,
      "--role",
      "link",
      "--name",
      "Next page",
    ]);
    expect(focus.code).toBe(0);
    expect((await click("link", "Next page")).code).toBe(0);
    const stop = await runCli(["timeline", "stop", ...base]);
    expect(stop.code).toBe(0);
    const lines = stop.stdout.trimEnd().split("\n");
    // Streamed out before the document went away, and kept.
    expect(lines).toContain('focus     link "Next page"');
    expect(lines.at(-1)).toMatch(
      /^\(a navigation ended the recording: the page moved to file:\/\/.*next\.html, and the lines above came before it\)$/,
    );

    // JSON carries the same as data: `navigated`, and the landed URL.
    expect(
      (await runCli(["timeline", "start", url, ...base, "--root", "main"]))
        .code,
    ).toBe(0);
    expect((await click("link", "Next page")).code).toBe(0);
    const json = await runCli([
      "timeline",
      "stop",
      ...base,
      "--format",
      "json",
    ]);
    const body = JSON.parse(json.stdout) as {
      command: string;
      pages: { url: string; navigated: boolean; events: unknown[] }[];
    };
    expect(body.command).toBe("timeline");
    expect(body.pages[0].navigated).toBe(true);
    expect(body.pages[0].url).toMatch(/next\.html$/);
  }, 90_000);

  it("applies the config's redact patterns to the lines and the JSON events", async () => {
    const config = join(dir, "a11y.config.json");
    writeFileSync(config, JSON.stringify({ redact: ["Draft \\w+\\."] }));
    const withConfig = [
      "--session",
      name,
      "--allow-file",
      "-q",
      "--config",
      config,
    ];
    expect(
      (
        await runCli([
          "timeline",
          "start",
          url,
          ...withConfig,
          "--root",
          "main",
        ])
      ).code,
    ).toBe(0);
    expect(
      (
        await runCli([
          "click",
          url,
          ...withConfig,
          "--role",
          "button",
          "--name",
          "Delete draft",
        ])
      ).code,
    ).toBe(0);
    const json = await runCli([
      "timeline",
      "stop",
      ...withConfig,
      "--format",
      "json",
    ]);
    expect(json.code).toBe(0);
    expect(json.stdout).not.toContain("Draft deleted.");
    const page = (
      JSON.parse(json.stdout) as {
        pages: { timeline: string; events: { text?: string }[] }[];
      }
    ).pages[0];
    expect(page.timeline).toContain('announce  status "[REDACTED]"');
    expect(page.events.some((e) => e.text === "[REDACTED]")).toBe(true);
  }, 90_000);

  it("withholds typed editor text under --redact-input, and refuses a strict stop of a lax start", async () => {
    // A navigation first, so the page is fresh.
    const fresh = await runCli(["tree", url, ...base]);
    expect(fresh.code).toBe(0);
    expect(
      (await runCli(["timeline", "start", url, ...base, "--redact-input"]))
        .code,
    ).toBe(0);
    expect((await click("button", "Fill note", ["--redact-input"])).code).toBe(
      0,
    );
    const stop = await runCli(["timeline", "stop", ...base, "--redact-input"]);
    expect(stop.code).toBe(0);
    expect(stop.stdout).not.toContain("1234");
    expect(stop.stdout).toContain('announce  generic "[redacted]"');

    expect((await runCli(["timeline", "start", url, ...base])).code).toBe(0);
    const strictStop = await runCli([
      "timeline",
      "stop",
      ...base,
      "--redact-input",
    ]);
    expect(strictStop.code).toBe(2);
    expect(strictStop.stdout).toBe("");
    expect(strictStop.stderr).toMatch(/--redact-input was not set/);
    // The recording is kept, for a stop without the flag.
    const laxStop = await runCli(["timeline", "stop", ...base]);
    expect(laxStop.code).toBe(0);
  }, 90_000);

  it("runs on a session the config names, stop included", async () => {
    const config = join(dir, "session.config.json");
    writeFileSync(config, JSON.stringify({ defaults: { session: name } }));
    const viaConfig = ["--allow-file", "-q", "--config", config];
    expect(
      (await runCli(["timeline", "start", url, ...viaConfig, "--root", "main"]))
        .code,
    ).toBe(0);
    const stop = await runCli(["timeline", "stop", ...viaConfig]);
    expect(stop.stderr).toBe("");
    expect(stop.code).toBe(0);
  }, 90_000);

  it("says so, launching nothing, when the session isn't running", async () => {
    const missing = `timeline-missing-${process.pid}`;
    const stop = await runCli([
      "timeline",
      "stop",
      "--session",
      missing,
      "--no-config",
    ]);
    expect(stop.code).toBe(2);
    expect(stop.stderr).toMatch(
      new RegExp(`no session "${missing}" is running`),
    );
    const list = await runCli([
      "session",
      "list",
      "--format",
      "json",
      "--no-config",
    ]);
    expect(list.stdout).not.toContain(missing);
  }, 90_000);

  it("explains what is missing", async () => {
    const noSession = await runCli([
      "timeline",
      "start",
      url,
      "--allow-file",
      "--no-config",
    ]);
    expect(noSession.code).toBe(2);
    expect(noSession.stderr).toMatch(/timeline needs --session/);

    const stopNone = await runCli(["timeline", "stop", ...base]);
    expect(stopNone.code).toBe(2);
    expect(stopNone.stderr).toMatch(/no timeline is recording/);

    const badRoot = await runCli([
      "timeline",
      "start",
      url,
      ...base,
      "--root",
      "#nope",
    ]);
    expect(badRoot.code).toBe(2);
    expect(badRoot.stderr).toMatch(/--root "#nope" matched no element/);

    const twice = await runCli(["timeline", "start", url, ...base]);
    expect(twice.code).toBe(0);
    const again = await runCli(["timeline", "start", url, ...base]);
    expect(again.code).toBe(2);
    expect(again.stderr).toMatch(/already recording/);
    expect((await runCli(["timeline", "stop", ...base])).code).toBe(0);

    const stopUrl = await runCli(["timeline", "stop", url, ...base]);
    expect(stopUrl.code).toBe(2);
    expect(stopUrl.stderr).toMatch(/timeline stop takes no URL/);
  }, 90_000);
});
