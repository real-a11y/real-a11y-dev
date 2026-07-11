/**
 * Report writing. stdout is the report channel — progress and diagnostics go
 * to stderr (see progress()). `--output` writes are atomic (tmp + rename in
 * the target directory) so a killed run never leaves a half-written report
 * for CI to silently ingest; overwrites are silent (CI regenerates); no
 * prompts, ever.
 */

import { randomBytes } from "node:crypto";
import { renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { registerCleanup } from "./cleanup.js";
import { CliError } from "./exit.js";

/**
 * Fail a bad --output path BEFORE the audit runs — discovering a typo'd
 * directory after a multi-page browser run discards all the results.
 * writeReport re-checks as a late safety net.
 */
export function assertWritableTarget(target: string): void {
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
}

/**
 * Atomic write: tmp (random suffix, exclusive create) + rename, so a killed
 * run never leaves a half-written file and a predictable name can't be
 * pre-created/symlinked by another local user. `mode` sets the tmp file's
 * permissions at create time (e.g. 0o600 for credential files) — honored on
 * POSIX, a no-op on Windows.
 */
export function writeFileAtomic(
  target: string,
  content: string,
  options: { mode?: number } = {},
): string {
  const abs = resolve(target);
  assertWritableTarget(abs);
  const tmp = `${abs}.tmp-${randomBytes(6).toString("hex")}`;
  const unregister = registerCleanup(() => {
    try {
      unlinkSync(tmp);
    } catch {
      // already renamed or never written
    }
  });
  try {
    writeFileSync(tmp, content, {
      encoding: "utf8",
      flag: "wx",
      ...(options.mode !== undefined ? { mode: options.mode } : {}),
    });
    renameSync(tmp, abs);
  } finally {
    unregister();
  }
  return abs;
}

export function writeReport(
  target: string | undefined,
  content: string,
): void {
  if (!target) {
    process.stdout.write(content);
    return;
  }
  const abs = writeFileAtomic(target, content);
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
