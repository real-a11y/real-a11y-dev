/**
 * `real-a11y show-report` — the snapshot report of a test run, served locally
 * and kept current as the tests write new records. It runs no tests and opens
 * no page of its own, so it never loads playwright.
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { parsePort, type CommandFn } from "../args.js";
import { onInterrupt } from "../cleanup.js";
import { CliError, EXIT } from "../exit.js";
import { progress } from "../output.js";
import { readRecords, startReportServer } from "../show-report/server.js";

/** Where `@real-a11y-dev/testing/reporter` writes unless told otherwise. */
const DEFAULT_DIR = "a11y-snapshots";

/** The file the reporter marks its records folder with. */
const RECORDS_MARKER = ".real-a11y-records";

/**
 * The records folder a target names: the reporter's output folder, or the
 * records folder itself. With no target the default folder may not exist yet,
 * since the first test run makes it; one you named is expected to.
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
  return existsSync(join(dir, RECORDS_MARKER)) ? dir : join(dir, "records");
}

/** The platform's own way to open a URL in the default browser. */
export function browserCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): [command: string, args: string[]] {
  if (platform === "win32") return ["cmd", ["/c", "start", "", url]];
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
    viewer: readViewer(),
    port,
  });
  const stopped = new Promise<void>((done) => onInterrupt(done));

  process.stdout.write(`${server.url}\n`);
  progress(`showing the snapshot report from ${recordsDir}`, { quiet });
  if (readRecords(recordsDir).length === 0) {
    progress(
      "no snapshots recorded yet: the page fills in as your tests run with @real-a11y-dev/testing/reporter",
      { quiet },
    );
  }
  progress("press Ctrl+C to stop", { quiet });

  if (flags["no-open"] !== true && !process.env.CI) openBrowser(server.url);

  await stopped;
  await server.close();
  return EXIT.OK;
};
