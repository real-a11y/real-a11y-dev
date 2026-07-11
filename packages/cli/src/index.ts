#!/usr/bin/env node
/**
 * real-a11y — bin entry.
 *
 * Exit discipline: set `process.exitCode` and let the loop drain naturally so
 * piped stdout is never truncated (a real Windows failure mode with
 * `process.exit`). `process.exit` is reserved for the double-Ctrl-C path.
 */

import { runCleanups } from "./cleanup.js";
import { EXIT } from "./exit.js";
import { run } from "./run.js";

// An inherited shell var must never widen the file:// policy — commands
// re-set this in-process only after the CLI's own gate approves a target.
delete process.env.REAL_A11Y_MCP_ALLOW_FILE;

let interrupted = false;
const onSignal = (): void => {
  if (interrupted) process.exit(EXIT.ERROR);
  interrupted = true;
  process.stderr.write("real-a11y: error: interrupted\n");
  void runCleanups().finally(() => process.exit(EXIT.ERROR));
};
process.on("SIGINT", onSignal);
process.on("SIGTERM", onSignal);

try {
  process.exitCode = await run(process.argv.slice(2));
} catch (err) {
  const detail =
    err instanceof Error ? (err.stack ?? err.message) : String(err);
  process.stderr.write(`real-a11y: error: unexpected failure — ${detail}\n`);
  process.exitCode = EXIT.ERROR;
} finally {
  await runCleanups();
}
