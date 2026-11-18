/**
 * Process-wide cleanup registry for Ctrl-C / SIGTERM: open browser sessions
 * and half-written `--output` tmp files register here, and the signal handler
 * in index.ts drains it before exiting — no orphaned Chromium, no stray tmp
 * files (worse on Windows, where orphans outlive the console).
 */

type Cleanup = () => Promise<void> | void;

const cleanups = new Set<Cleanup>();

/** How long further signals still count as the one that stopped the command. */
export const STOP_GRACE_MS = 2000;

let interruptHandler: (() => void) | null = null;
let stoppingSince: number | null = null;

/**
 * For a command that runs until you stop it: Ctrl-C is how it ends, not a
 * failure.
 */
export function onInterrupt(fn: () => void): void {
  interruptHandler = fn;
  stoppingSince = null;
}

/**
 * Hands a signal to the command that asked for it. True when that deals with
 * the signal: it stopped the command, or it is the same Ctrl-C arriving again,
 * since `npx` forwards to its child the signal the terminal already sent it.
 * After the grace period a signal is someone insisting, and false lets it out
 * of a stop that hangs.
 */
export function interruptCommand(now: number = Date.now()): boolean {
  if (interruptHandler) {
    const stop = interruptHandler;
    interruptHandler = null;
    stoppingSince = now;
    stop();
    return true;
  }
  return stoppingSince !== null && now - stoppingSince < STOP_GRACE_MS;
}

export function registerCleanup(fn: Cleanup): () => void {
  cleanups.add(fn);
  return () => cleanups.delete(fn);
}

export async function runCleanups(): Promise<void> {
  const pending = [...cleanups];
  cleanups.clear();
  // `async` so a cleanup that throws synchronously becomes one rejected entry
  // rather than throwing out of `map` and skipping every cleanup after it.
  await Promise.allSettled(pending.map(async (fn) => fn()));
}
