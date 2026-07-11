/**
 * Process-wide cleanup registry for Ctrl-C / SIGTERM: open browser sessions
 * and half-written `--output` tmp files register here, and the signal handler
 * in index.ts drains it before exiting — no orphaned Chromium, no stray tmp
 * files (worse on Windows, where orphans outlive the console).
 */

type Cleanup = () => Promise<void> | void;

const cleanups = new Set<Cleanup>();

export function registerCleanup(fn: Cleanup): () => void {
  cleanups.add(fn);
  return () => cleanups.delete(fn);
}

export async function runCleanups(): Promise<void> {
  const pending = [...cleanups];
  cleanups.clear();
  await Promise.allSettled(pending.map((fn) => fn()));
}
