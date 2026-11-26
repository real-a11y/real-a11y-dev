/**
 * `@real-a11y-dev/testing/reporter` — a Vitest reporter that turns a run's
 * a11y snapshots into one page you can open: each boxed snapshot (a
 * `boxedTreeSnapshot()`, `boxedTabSequenceSnapshot()`, `boxedOutlineSnapshot()`
 * or `a11yDiff()`) drawn the way the Semantic Navigator panel draws a tree,
 * with the states, the actions and the change marks its text leaves
 * out. Jest has its own: `@real-a11y-dev/testing/reporter/jest`.
 *
 * ```ts
 * // vitest.config.ts
 * export default defineConfig({
 *   test: {
 *     reporters: ["default", "@real-a11y-dev/testing/reporter"],
 *   },
 * });
 * ```
 *
 * It switches the recorder on (`snapshot-record.ts`) for the run, pointed at
 * `<outputDir>/records`, and after each run writes `<outputDir>/index.html`:
 * one self-contained file, the viewer and the records inlined, that opens
 * from disk and travels as a CI artifact. A rerun in watch mode replaces only
 * the records of the files it ran.
 *
 * The `.snap` text stays the assertion; this never fails a run.
 */

import { resolve } from "node:path";

import { TREES_DIR_ENV } from "./snapshot-record.js";
import {
  DEFAULT_OUTPUT_DIR,
  SnapshotReport,
  type A11ySnapshotReporterOptions,
} from "./snapshot-report.js";

// The reporter is this entry's only export. Its CJS build is
// `module.exports = Reporter` (cjsInterop), typed `export =`, and that allows
// no other export beside it.

/** The part of Vitest's context the reporter reads. */
interface VitestLike {
  config: {
    root: string;
    env?: Record<string, string | undefined>;
    mergeReports?: unknown;
  };
  logger?: { log(message: string): void };
}

/** The part of a Vitest test specification the reporter reads. */
interface SpecificationLike {
  moduleId: string;
  project?: { name?: string };
}

export default class A11ySnapshotReporter {
  private readonly options: A11ySnapshotReporterOptions;
  private report: SnapshotReport | null = null;
  private merging = false;
  private log: (message: string) => void = (message) => console.log(message);

  constructor(options: A11ySnapshotReporterOptions = {}) {
    this.options = options;
  }

  onInit(vitest: VitestLike): void {
    const { logger } = vitest;
    if (logger) this.log = (message) => logger.log(message);
    this.report = new SnapshotReport(
      resolve(vitest.config.root, this.options.outputDir ?? DEFAULT_OUTPUT_DIR),
    );
    // `--merge-reports` runs no test: it replays the shards' runs, so the
    // page is made from the records there are, and none is cleared.
    this.merging = Boolean(vitest.config.mergeReports);
    const on = this.report.start({ clear: !this.merging });
    // Vitest also hands its workers `test.env`.
    if (on && vitest.config.env) {
      vitest.config.env[TREES_DIR_ENV] = this.report.recordsDir;
    }
  }

  onTestRunStart(specifications: ReadonlyArray<SpecificationLike>): void {
    if (this.merging) return;
    // A rerun replaces the records of the files it runs and keeps the rest.
    for (const { moduleId, project } of specifications) {
      this.report?.clearFile(moduleId, project?.name || undefined);
    }
  }

  onTestRunEnd(): void {
    if (this.report) this.log(`\n${this.report.writeAndSay()}\n`);
  }
}
