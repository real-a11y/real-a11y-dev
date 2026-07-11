/**
 * Report writing. stdout is the report channel — progress and diagnostics go
 * to stderr (see progress()). `--output` writes are atomic (tmp + rename in
 * the target directory) so a killed run never leaves a half-written report
 * for CI to silently ingest; overwrites are silent (CI regenerates); no
 * prompts, ever.
 */

import { renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { registerCleanup } from "./cleanup.js";
import { CliError } from "./exit.js";

export function writeReport(
  target: string | undefined,
  content: string,
): void {
  if (!target) {
    process.stdout.write(content);
    return;
  }
  const abs = resolve(target);
  try {
    if (statSync(abs).isDirectory()) {
      throw new CliError(`--output target is a directory: ${abs}`);
    }
  } catch (err) {
    if (err instanceof CliError) throw err;
    // ENOENT: fine — the file doesn't exist yet.
  }
  try {
    statSync(dirname(abs));
  } catch {
    throw new CliError(
      `--output parent directory does not exist: ${dirname(abs)}`,
    );
  }
  const tmp = `${abs}.tmp-${process.pid}`;
  const unregister = registerCleanup(() => {
    try {
      unlinkSync(tmp);
    } catch {
      // already renamed or never written
    }
  });
  try {
    writeFileSync(tmp, content, "utf8");
    renameSync(tmp, abs);
  } finally {
    unregister();
  }
  process.stderr.write(`report written to ${abs}\n`);
}

export interface ProgressOptions {
  quiet?: boolean;
}

/** Stderr progress line — suppressed by --quiet, never part of the report. */
export function progress(message: string, options: ProgressOptions): void {
  if (options.quiet) return;
  process.stderr.write(`${message}\n`);
}
