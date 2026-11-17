/**
 * `@real-a11y-dev/testing/reporter/jest` — the snapshot report for Jest: the
 * Vitest reporter's page (`reporter.ts`), written after each Jest run.
 *
 * ```js
 * // jest.config.js
 * module.exports = {
 *   reporters: ["default", "@real-a11y-dev/testing/reporter/jest"],
 * };
 * ```
 *
 * Jest builds its reporters before it starts a worker, so switching the
 * recorder on here reaches every test file, in band or not. It builds them
 * again for each run in watch mode, so only the first clears the records: a
 * rerun replaces only the records of the files it runs.
 */

import { resolve } from "node:path";

import {
  DEFAULT_OUTPUT_DIR,
  SnapshotReport,
  type A11ySnapshotReporterOptions,
} from "./snapshot-report.js";

// The reporter is this entry's only export. Its CJS build is
// `module.exports = Reporter` (cjsInterop), typed `export =`, and that allows
// no other export beside it.

/** The part of Jest's global config the reporter reads. */
interface JestGlobalConfigLike {
  rootDir: string;
}

/** The part of a Jest test the reporter reads. */
interface JestTestLike {
  path: string;
}

// The report folders this process has started: a watch run's reporter
// carries on with the records the runs before it wrote.
const started = new Set<string>();

export default class A11ySnapshotJestReporter {
  private readonly report: SnapshotReport;

  constructor(
    globalConfig: JestGlobalConfigLike,
    options: A11ySnapshotReporterOptions = {},
  ) {
    this.report = new SnapshotReport(
      resolve(globalConfig.rootDir, options.outputDir ?? DEFAULT_OUTPUT_DIR),
    );
    this.report.start({ clear: !started.has(this.report.outputDir) });
    started.add(this.report.outputDir);
  }

  onTestFileStart(test: JestTestLike): void {
    this.report.clearFile(test.path);
  }

  onRunComplete(): void {
    process.stderr.write(`\n${this.report.writeAndSay()}\n\n`);
  }

  /** Jest asks every reporter; the report never fails a run. */
  getLastError(): undefined {
    return undefined;
  }
}
