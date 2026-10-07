import { useCallback, useEffect, useRef } from "preact/hooks";

/**
 * One pending callback that runs once something has rested for `ms` — the
 * native tree's selection follow and hover preview, each a debugger round
 * trip, so only the row a run of key repeats or a pointer sweep settles on
 * is sent. `schedule` replaces whatever is pending, `cancel` drops it,
 * `flush` runs it now, and unmounting cancels it.
 */
export function useDwellTimer(ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<(() => void) | undefined>(undefined);
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
    pending.current = undefined;
  }, []);
  const schedule = useCallback(
    (fn: () => void) => {
      clearTimeout(timer.current);
      pending.current = fn;
      timer.current = setTimeout(() => {
        timer.current = undefined;
        pending.current = undefined;
        fn();
      }, ms);
    },
    [ms],
  );
  const flush = useCallback(() => {
    const fn = pending.current;
    cancel();
    fn?.();
  }, [cancel]);
  useEffect(() => cancel, [cancel]);
  return { schedule, cancel, flush };
}
