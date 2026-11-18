/**
 * `real-a11y show-report` — the snapshot report of a test run, served locally
 * and kept current as the tests write new records. It runs no tests and opens
 * no page of its own, so it never loads playwright.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePort, type CommandFn } from "../args.js";
import { onInterrupt } from "../cleanup.js";
import { CliError, EXIT } from "../exit.js";
import { progress } from "../output.js";
import { hasRecords, startReportServer } from "../show-report/server.js";

/** Where `@real-a11y-dev/testing/reporter` writes unless told otherwise. */
const DEFAULT_DIR = "a11y-snapshots";

/** How long the command stays once stopped, for a repeat of the signal. */
const SIGNAL_LINGER_MS = 150;

/**
 * The records folder a target names: the reporter's output folder, or a folder
 * of records itself (the reporter's, or one `REAL_A11Y_TREES_DIR` filled). With
 * no target the default folder may not exist yet, since the first test run
 * makes it; one you named is expected to.
 */
export function recordsDirFor(target: string | undefined): string {
  const dir = resolve(target ?? DEFAULT_DIR);
  if (target !== undefined) {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(target)) {
      throw new CliError(
        `show-report takes a folder of recorded snapshots, not a URL (got ${target})`,
        "to audit a page, use 'real-a11y audit <url>' or 'real-a11y snapshot <url>'",
      );
    }
    let isDirectory: boolean;
    try {
      isDirectory = statSync(dir).isDirectory();
    } catch {
      throw new CliError(
        `no such folder: ${dir}`,
        "run your tests with @real-a11y-dev/testing/reporter first, or pass the folder its outputDir names",
      );
    }
    if (!isDirectory) throw new CliError(`not a folder: ${dir}`);
  }
  const records = join(dir, "records");
  return target === undefined || existsSync(records) ? records : dir;
}

/**
 * The `outputDir` that fills the folder you named, as you wrote it. None for
 * the current folder: the reporter's default lands under it. For a `records`
 * folder read as it is, its parent: the reporter adds `records` itself.
 */
export function outputDirFor(target: string | undefined): string | undefined {
  if (target === undefined) return undefined;
  const dir = resolve(target);
  if (dir === process.cwd()) return undefined;
  const isRecords =
    basename(dir) === "records" && !existsSync(join(dir, "records"));
  return isRecords ? dirname(target) : target;
}

/**
 * The platform's own way to open a URL in the default browser. Windows gets
 * `cmd.exe` by its full path: given a bare name it looks in the current folder
 * first, and this runs inside whatever project you are looking at, so a
 * `cmd.exe` committed to that project would run in its place.
 */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): [command: string, args: string[]] {
  if (platform === "win32") {
    const system = process.env.SystemRoot ?? "C:\\Windows";
    const cmd = win32.join(system, "System32", "cmd.exe");
    return [cmd, ["/c", "start", "", url]];
  }
  if (platform === "darwin") return ["open", [url]];
  return ["xdg-open", [url]];
}

function openBrowser(url: string): void {
  const [command, args] = browserCommand(url);
  const child = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  // No opener here (a container, a server): the URL is printed all the same.
  child.on("error", () => {});
  child.unref();
}

/** The viewer's build, which `tsup.config.ts` copies next to the bundle. */
function readViewer(): { js: string; css: string } {
  const dir = fileURLToPath(new URL("./viewer/", import.meta.url));
  try {
    return {
      js: readFileSync(join(dir, "viewer.js"), "utf8"),
      css: readFileSync(join(dir, "viewer.css"), "utf8"),
    };
  } catch (err) {
    throw new CliError(
      `this install is missing the report viewer: ${(err as Error).message}`,
      "reinstall @real-a11y-dev/cli",
    );
  }
}

export const showReportCommand: CommandFn = async (positionals, flags) => {
  if (positionals.length > 1) {
    throw new CliError(
      `show-report takes one folder (got ${positionals.join(", ")})`,
      "usage: real-a11y show-report [dir] [--port <n>] [--no-open]",
    );
  }
  const recordsDir = recordsDirFor(positionals[0]);
  const port = parsePort(flags.port);
  const quiet = flags.quiet === true;

  const server = await startReportServer({
    recordsDir,
    outputDir: outputDirFor(positionals[0]),
    viewer: readViewer(),
    port,
  });
  const stopped = new Promise<void>((done) => onInterrupt(done));

  process.stdout.write(`${server.url}\n`);
  progress(`showing the snapshot report from ${recordsDir}`, { quiet });
  if (!quiet && !hasRecords(recordsDir)) {
    progress(
      "no snapshots recorded yet: the page fills in as your tests run with @real-a11y-dev/testing/reporter",
      { quiet },
    );
  }
  progress("press Ctrl+C to stop", { quiet });

  if (flags["no-open"] !== true && !process.env.CI) openBrowser(server.url);

  await stopped;
  await server.close();
  // A second copy of the Ctrl+C may be on its way (`npx` forwards the one the
  // terminal sent). Landing while the process exits, it would end it as failed.
  await new Promise((done) => setTimeout(done, SIGNAL_LINGER_MS));
  return EXIT.OK;
};
