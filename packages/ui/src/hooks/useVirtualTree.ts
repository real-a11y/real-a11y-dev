import { useCallback, useEffect, useRef, useState } from "preact/hooks";

/** Default row height in pixels; matches the `--sn-line-height` theme token. */
const DEFAULT_ROW_HEIGHT = 24;
/** Rows to render above and below the visible viewport to avoid blank flashes. */
const DEFAULT_OVERSCAN = 5;

export interface UseVirtualTreeOptions {
  /** Height of each row in pixels. Defaults to 24. */
  rowHeight?: number;
  /** Extra rows to render above and below the viewport. */
  overscan?: number;
}

export interface UseVirtualTreeResult {
  /**
   * Attach this to the scrollable `.sn-tree-container` element.
   *
   * It is a callback ref rather than an object ref so the hook is notified
   * the moment the container mounts, remounts, or unmounts — the container
   * may render conditionally (e.g. behind a "Connecting…" screen), so the
   * viewport can only be measured once the node is actually in the DOM.
   */
  containerRef: (node: HTMLDivElement | null) => void;
  /** Total scrollable height for the inner tree list. */
  totalHeight: number;
  /** Index of the first rendered row (includes overscan). */
  startIndex: number;
  /** Index one past the last rendered row (includes overscan). */
  endIndex: number;
  /** Vertical offset in pixels for the first rendered row. */
  offset: number;
  /** Attach this to the scrollable container's `onScroll`. */
  onScroll: (e: Event) => void;
  /** Scroll the container so the row at `index` is visible. */
  scrollToIndex: (
    index: number,
    block?: "start" | "center" | "end" | "nearest",
  ) => void;
}

/**
 * Fixed-height list virtualization for the flattened `visibleNodeIds` tree.
 *
 * The tree rows are all a single fixed height (`--sn-line-height`, 24px), and
 * the list has already been flattened to a single array of ids, which makes
 * windowing cheap: read `scrollTop`/`clientHeight`, compute a slice, and render
 * only the rows in the viewport plus overscan.
 */
export function useVirtualTree(
  itemCount: number,
  options: UseVirtualTreeOptions = {},
): UseVirtualTreeResult {
  const rowHeight = options.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const overscan = options.overscan ?? DEFAULT_OVERSCAN;

  const nodeRef = useRef<HTMLDivElement | null>(null);
  const teardownRef = useRef<(() => void) | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  // Latest itemCount/rowHeight, read inside scrollToIndex so it can keep a
  // stable identity (deps []). Otherwise every expand/collapse (which changes
  // itemCount) would give scrollToIndex a new identity, re-firing consumers'
  // selectedId-keyed scroll effects and yanking the viewport back to the
  // selection.
  const itemCountRef = useRef(itemCount);
  itemCountRef.current = itemCount;
  const rowHeightRef = useRef(rowHeight);
  rowHeightRef.current = rowHeight;

  const updateViewport = useCallback(() => {
    const container = nodeRef.current;
    if (!container) return;
    setViewportHeight(container.clientHeight);
    setScrollTop(container.scrollTop);
  }, []);

  // Callback ref: fires whenever the scrollable container mounts (`node`) or
  // unmounts (`null`). Measuring here — instead of in a one-shot mount effect —
  // guarantees the viewport is read once the node is really in the DOM, even
  // when it renders conditionally after first paint.
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      teardownRef.current?.();
      teardownRef.current = null;
      nodeRef.current = node;
      if (!node) return;

      updateViewport();

      let ro: ResizeObserver | undefined;
      if (typeof ResizeObserver !== "undefined") {
        ro = new ResizeObserver(updateViewport);
        ro.observe(node);
      }

      const onWindowResize = () => updateViewport();
      window.addEventListener("resize", onWindowResize);

      teardownRef.current = () => {
        ro?.disconnect();
        window.removeEventListener("resize", onWindowResize);
      };
    },
    [updateViewport],
  );

  useEffect(() => () => teardownRef.current?.(), []);

  const handleScroll = useCallback((e: Event) => {
    const container = e.currentTarget as HTMLDivElement;
    setScrollTop(container.scrollTop);
    setViewportHeight(container.clientHeight);
  }, []);

  const totalHeight = itemCount * rowHeight;
  // Clamp scrollTop to the valid range: when the list shrinks (collapse-all,
  // expand/collapse, or a search filter) while the user is scrolled down, the
  // saved scrollTop still holds the old, larger value for a frame. Without the
  // clamp, startIndex could exceed itemCount and the slice would render empty
  // until the browser corrects scrollTop and fires a scroll event.
  const maxScrollTop = Math.max(0, totalHeight - viewportHeight);
  const clampedScrollTop = Math.min(scrollTop, maxScrollTop);
  const startIndex = Math.max(
    0,
    Math.floor(clampedScrollTop / rowHeight) - overscan,
  );
  const endIndex =
    viewportHeight > 0
      ? Math.min(
          itemCount,
          Math.ceil((clampedScrollTop + viewportHeight) / rowHeight) + overscan,
        )
      : Math.min(itemCount, startIndex + overscan * 2);
  const offset = startIndex * rowHeight;

  const scrollToIndex = useCallback(
    (
      index: number,
      block: "start" | "center" | "end" | "nearest" = "nearest",
    ) => {
      const container = nodeRef.current;
      const count = itemCountRef.current;
      const rh = rowHeightRef.current;
      if (!container || count === 0) return;

      const clamped = Math.max(0, Math.min(index, count - 1));
      const rowTop = clamped * rh;

      switch (block) {
        case "start": {
          container.scrollTop = rowTop;
          return;
        }
        case "end": {
          container.scrollTop = Math.max(
            0,
            rowTop - container.clientHeight + rh,
          );
          return;
        }
        case "center": {
          container.scrollTop = Math.max(
            0,
            rowTop - container.clientHeight / 2 + rh / 2,
          );
          return;
        }
        case "nearest": {
          const top = container.scrollTop;
          const bottom = top + container.clientHeight;
          if (rowTop < top) {
            container.scrollTop = rowTop;
          } else if (rowTop + rh > bottom) {
            container.scrollTop = Math.max(
              0,
              rowTop - container.clientHeight + rh,
            );
          }
          return;
        }
      }
    },
    [],
  );

  return {
    containerRef,
    totalHeight,
    startIndex,
    endIndex,
    offset,
    onScroll: handleScroll,
    scrollToIndex,
  };
}
