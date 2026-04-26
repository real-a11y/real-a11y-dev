import { DomObserver } from "@real-a11y-dev/core";

export interface WaitForMutationsOptions {
  /** Give up and resolve after this many ms even if no mutation fires. Default 1000. */
  timeout?: number;
  /**
   * Debounce used by the internal DomObserver. Default 50ms in tests (vs. 300
   * in the live extension) so tests don't wait longer than necessary.
   */
  debounceMs?: number;
}

/**
 * Resolve on the next DOM mutation inside `root`, after the observer's
 * debounce fires — or on timeout, whichever comes first.
 *
 * Wraps {@link DomObserver} so tests can drive the same mutation-observation
 * logic the live extension uses, instead of reimplementing polling loops.
 */
export function waitForMutations(
  root: Element,
  options: WaitForMutationsOptions = {},
): Promise<void> {
  const { timeout = 1000, debounceMs = 50 } = options;

  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      observer.stop();
      clearTimeout(timer);
      resolve();
    };

    const observer = new DomObserver(root, finish, debounceMs);
    observer.start();
    const timer = setTimeout(finish, timeout);
  });
}
