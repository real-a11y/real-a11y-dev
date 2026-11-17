/**
 * The snapshot report (`reporter.ts` for Vitest, `reporter-jest.ts` for
 * Jest): the records a run wrote, read back, and the one HTML file that
 * draws them. Each runner's reporter only says when; this does the rest.
 *
 * It deletes and overwrites only what it wrote itself: a records folder it
 * marked, and a page it generated. Pointed at a folder that holds anything
 * else under those names, it leaves that alone and records nothing.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  RECORD_VERSION,
  recordFolder,
  TREES_DIR_ENV,
  type SnapshotRecord,
} from "./snapshot-record.js";

export interface A11ySnapshotReporterOptions {
  /**
   * Where the report goes, relative to the runner's root directory. Default
   * `"a11y-snapshots"`: `index.html` and the `records/` it is made from.
   */
  outputDir?: string;
}

/** Where a report goes when its options don't say. */
export const DEFAULT_OUTPUT_DIR = "a11y-snapshots";

/** The file that marks a records folder as the report's to delete. */
export const RECORDS_MARKER = ".real-a11y-records";

/** What a page the report generated says it is: `write()` overwrites only
 *  a page that says so. */
const GENERATOR = '<meta name="generator" content="real-a11y snapshot report">';

/** What the page reads (`window.__A11Y_SNAPSHOTS__` in the viewer). The
 *  records directory is the dev server's, for its empty state; a written
 *  page leaves it out, as a shared page must not carry a local path. */
export interface ReportData {
  dir?: string;
  records: (SnapshotRecord & { id: string })[];
}

/** The viewer's two files: its classic script and its stylesheet. */
export interface ViewerAssets {
  js: string;
  css: string;
}

/** One run's report: its records directory and the page made from it. */
export class SnapshotReport {
  readonly outputDir: string;
  readonly recordsDir: string;
  /** Why the report is off, once `start()` found it can't own its folder. */
  private off: string | null = null;

  constructor(outputDir: string) {
    this.outputDir = outputDir;
    this.recordsDir = join(outputDir, "records");
  }

  /**
   * Switch the recorder on, and with `clear` (the default) start from
   * nothing, so a test renamed or deleted since the last run leaves no record
   * behind. Call it before the runner starts its workers: they read the
   * variable as they start. Returns whether recording is on: a records
   * folder the report didn't mark is left alone, and nothing records.
   * `writeAndSay()` says why, once, where the run ends.
   */
  start({ clear = true }: { clear?: boolean } = {}): boolean {
    const marker = join(this.recordsDir, RECORDS_MARKER);
    if (existsSync(this.recordsDir) && !existsSync(marker)) {
      this.off =
        `${this.recordsDir} holds files the snapshot report didn't write, ` +
        "so it recorded nothing: set its outputDir to a folder of its own";
      return false;
    }
    if (clear) remove(this.recordsDir);
    try {
      mkdirSync(this.recordsDir, { recursive: true });
      writeFileSync(marker, "");
    } catch (error) {
      this.off = `couldn't make ${this.recordsDir}: ${(error as Error).message}`;
      return false;
    }
    process.env[TREES_DIR_ENV] = this.recordsDir;
    return true;
  }

  /** Drop one test file's records, before a rerun writes them again. */
  clearFile(testFile: string, project?: string): void {
    if (this.off) return;
    remove(
      join(
        this.recordsDir,
        recordFolder(relative(process.cwd(), testFile), project),
      ),
    );
  }

  /** Write `index.html` from every record there is; returns its URL. */
  write(viewer?: ViewerAssets): {
    url: string;
    count: number;
  } {
    if (this.off) throw new Error(this.off);
    const records = readRecords(this.recordsDir);
    mkdirSync(this.outputDir, { recursive: true });
    const page = join(this.outputDir, "index.html");
    if (existsSync(page) && !readFileSync(page, "utf8").includes(GENERATOR)) {
      throw new Error(`${page} isn't a snapshot report, so it stays as it is`);
    }
    writeFileSync(page, renderReport({ records }, viewer ?? viewerAssets()));
    return { url: pathToFileURL(page).href, count: records.length };
  }

  /** `write()`, said in one line, or why it couldn't be. Never throws. */
  writeAndSay(): string {
    if (this.off) return ` a11y snapshots  off: ${this.off}`;
    try {
      const { url, count } = this.write();
      return ` a11y snapshots  ${count} recorded → ${url}`;
    } catch (error) {
      return ` a11y snapshots  couldn't write the report: ${(error as Error).message}`;
    }
  }
}

/**
 * Delete `path`, or leave it: the report is optional, and a record that
 * outlives a failed delete costs a stale row, where a throw here would cost
 * the whole test run.
 */
function remove(path: string): void {
  try {
    rmSync(path, { recursive: true, force: true });
  } catch (error) {
    console.warn(
      ` a11y snapshots  couldn't clear ${path}: ${(error as Error).message}`,
    );
  }
}

/**
 * The viewer, built by `packages/snapshot-viewer` and shipped in
 * `dist/viewer`, next to the reporters that read it.
 */
function viewerAssets(): ViewerAssets {
  const dir = fileURLToPath(new URL("./viewer/", import.meta.url));
  return {
    js: readFileSync(join(dir, "viewer.js"), "utf8"),
    css: readFileSync(join(dir, "viewer.css"), "utf8"),
  };
}

/**
 * Every record under `dir`, each with its path there as its id. A record of
 * another version, or one that isn't JSON, is skipped: the page can't draw
 * it.
 */
export function readRecords(dir: string): ReportData["records"] {
  const found: ReportData["records"] = [];
  const walk = (folder: string) => {
    let entries;
    try {
      entries = readdirSync(folder, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const path = join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith(".json")) {
        const record = parseRecord(readFileSync(path, "utf8"));
        const id = relative(dir, path).split("\\").join("/");
        if (record) found.push({ ...record, id });
      }
    }
  };
  walk(dir);
  return found;
}

function parseRecord(text: string): SnapshotRecord | null {
  try {
    const record = JSON.parse(text) as SnapshotRecord;
    return record.version === RECORD_VERSION ? record : null;
  } catch {
    return null;
  }
}

/**
 * One page that opens from disk: everything inline, and the viewer a classic
 * script, which `file://` runs where a module script would not load. Nothing
 * inlined may close the element it sits in.
 */
export function renderReport(data: ReportData, viewer: ViewerAssets): string {
  const json = JSON.stringify(data).replace(/</g, "\\u003c");
  const js = viewer.js.replace(/<\/script/gi, "<\\/script");
  const css = viewer.css.replace(/<\/style/gi, "<\\/style");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${GENERATOR}
<title>A11y snapshots</title>
<style>${css}</style>
</head>
<body>
<div id="app"></div>
<script>window.__A11Y_SNAPSHOTS__ = ${json};</script>
<script>${js}</script>
</body>
</html>
`;
}
