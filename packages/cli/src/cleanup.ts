/**
 * Process-wide cleanup registry for Ctrl-C / SIGTERM: open browser sessions
 * and half-written `--output` tmp files register here, and the signal handler
 * in index.ts drains it before exiting — no orphaned Chromium, no stray tmp
 * files (worse on Windows, where orphans outlive the console).
 */

type Cleanup = () => Promise<void> | void;

const cleanups = new Set<Cleanup>();

let interruptHandler: (() => void) | null = null;

/**
 * For a command that runs until you stop it: Ctrl-C is how it ends, not a
 * failure. Takes the first signal only, so a second one still gets out if
 * stopping hangs.
 */
export function onInterrupt(fn: () => void): void {
  interruptHandler = fn;
}

/** The command's own way to stop, once, if it set one. */
export function takeInterruptHandler(): (() => void) | null {
  const fn = interruptHandler;
  interruptHandler = null;
  return fn;
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
