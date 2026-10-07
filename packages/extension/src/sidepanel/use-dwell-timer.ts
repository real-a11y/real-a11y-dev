import { useCallback, useEffect, useRef } from "preact/hooks";

/**
 * One pending callback that runs once something has rested for `ms` — the
 * native tree's selection follow and hover preview, each a debugger round
 * trip, so only the row a run of key repeats or a pointer sweep settles on
 * is sent. `schedule` replaces whatever is pending, `cancel` drops it, and
 * unmounting cancels it.
 */
export function useDwellTimer(ms: number) {
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = undefined;
  }, []);
  const schedule = useCallback(
    (fn: () => void) => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => {
        timer.current = undefined;
        fn();
      }, ms);
    },
    [ms],
  );
  useEffect(() => cancel, [cancel]);
  return { schedule, cancel };
}
