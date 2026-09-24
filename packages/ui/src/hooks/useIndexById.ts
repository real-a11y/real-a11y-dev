import { useMemo } from "preact/hooks";

/**
 * Index the flattened visible-row list by id, once per list identity.
 *
 * Both the panel and the keyboard hook need to turn the selected row id into
 * its position in `visibleNodeIds` — for `aria-activedescendant`, for
 * scroll-into-view, and for every arrow keypress. Reading that off the array
 * meant an O(N) `indexOf` each time, so arrow-key cost grew with the size of
 * the expanded tree; ArrowRight was worse still, scanning the list once per
 * child via `includes`. The callers already memoize the list itself, so
 * keying on its identity pays the walk once per change instead of per event.
 *
 * First occurrence wins, matching `indexOf` — ids are unique within a tree,
 * so this only matters if a caller passes a list that is not.
 */
export function useIndexById(ids: string[]): Map<string, number> {
  return useMemo(() => {
    const map = new Map<string, number>();
    for (let i = 0; i < ids.length; i++) {
      if (!map.has(ids[i])) map.set(ids[i], i);
    }
    return map;
  }, [ids]);
}
