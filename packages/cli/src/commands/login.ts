/**
 * `real-a11y login <url> --save <file>` — the human-driven "save the session"
 * step. Opens a visible browser, the human logs in by hand (MFA/SSO/passkeys
 * all work — a person is driving), then presses Enter to capture the storage
 * state. The MCP never does this; login is always a CLI + human action.
 *
 * Security: the saved file is a live credential — written 0o600 (POSIX), with
 * a warning when it lands un-gitignored inside a repo. We never print its
 * contents, only its path.
 */

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname } from "node:path";

import { parseOpenOptions, type CommandFn } from "../args.js";
import { CliError, EXIT } from "../exit.js";
import { writeFileAtomic } from "../output.js";
import { createSession, openPage } from "../session.js";
import { normalizeTarget } from "../url-gate.js";

/** Playwright ≥1.51 captures IndexedDB; older versions silently ignore the flag. */
function playwrightSupportsIndexedDB(): boolean {
  try {
    const require = createRequire(import.meta.url);
    const version = (require("playwright/package.json") as { version: string })
      .version;
    const [major, minor] = version.split(".").map((n) => Number(n));
    return major > 1 || (major === 1 && minor >= 51);
  } catch {
    return false;
  }
}

/** Warn when the credential file sits inside a git repo and isn't ignored. */
function warnIfTracked(savePath: string): void {
  try {
    // check-ignore exits 0 when the path IS ignored, 1 when it is not.
    execFileSync("git", ["check-ignore", "-q", savePath], {
      cwd: dirname(savePath),
      stdio: "ignore",
    });
  } catch (err) {
    const code = (err as { status?: number }).status;
    // status 1 = not ignored, but only warn when we're actually in a repo
    // (128 = not a git repo; anything else = git missing → skip silently).
    if (code === 1) {
      try {
        execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
          cwd: dirname(savePath),
          stdio: "ignore",
        });
        process.stderr.write(
          `warning: ${savePath} is inside a git repository and not ignored — add it to .gitignore (it holds live session tokens).\n`,
        );
      } catch {
        // not a repo — nothing to warn about
      }
    }
  }
}

function waitForEnter(): Promise<void> {
  return new Promise((resolve, reject) => {
    process.stderr.write(
      "Log in in the browser window, then press Enter here to save.\n",
    );
    const onData = (chunk: Buffer): void => {
      if (chunk.includes(0x0a) || chunk.includes(0x0d)) {
        cleanup();
        resolve();
      }
    };
    const onEnd = (): void => {
      cleanup();
      reject(new CliError("stdin closed before Enter was pressed."));
    };
    const cleanup = (): void => {
      process.stdin.off("data", onData);
      process.stdin.off("end", onEnd);
      if (process.stdin.isTTY) process.stdin.setRawMode?.(false);
      process.stdin.pause();
    };
    if (process.stdin.isTTY) process.stdin.setRawMode?.(true);
    process.stdin.resume();
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
  });
}

export const loginCommand: CommandFn = async (positionals, flags) => {
  if (positionals.length !== 1) {
    throw new CliError(
      `login takes exactly one URL (got ${positionals.length})`,
      "usage: real-a11y login <url> --save <file>",
    );
  }
  const save = flags.save;
  if (typeof save !== "string" || save === "") {
    throw new CliError(
      "login needs --save <file> to write the session to.",
      "usage: real-a11y login <url> --save auth.json",
    );
  }
  // Interactive by construction — a human logs in. Fail fast in CI.
  if (!process.stdin.isTTY) {
    throw new CliError(
      "login is interactive — it needs a terminal and a human.",
      "in CI, provision the storage state file from a secret instead.",
    );
  }

  const url = normalizeTarget(positionals[0]);
  const openOptions = parseOpenOptions(flags);
  // Forced headful (you can't log in to a headless window); no device
  // emulation (log in at desktop, emulate at audit time); no auth loaded.
  const session = await createSession({ headful: true });
  try {
    await openPage(session, url, openOptions, false);
    await waitForEnter();
    const state = await session.captureStorageState({
      indexedDB: playwrightSupportsIndexedDB(),
    });
    const abs = writeFileAtomic(save, `${JSON.stringify(state, null, 2)}\n`, {
      mode: 0o600,
    });
    warnIfTracked(abs);
    process.stderr.write(
      `saved session state to ${abs} — treat it like a password; it expires when the site's session does.\n` +
        "note: session storage isn't captured — apps that keep auth there will need --cdp instead.\n",
    );
    return EXIT.OK;
  } finally {
    await session.close();
  }
};
