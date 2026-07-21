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
  /** Attach this to the scrollable `.sn-tree-container` element. */
  containerRef: { current: HTMLDivElement | null };
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

  const containerRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);

  const updateViewport = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    setViewportHeight(container.clientHeight);
    setScrollTop(container.scrollTop);
  }, []);

  useEffect(() => {
    updateViewport();

    const container = containerRef.current;
    if (!container) return;

    let ro: ResizeObserver | undefined;
    if (typeof ResizeObserver !== "undefined") {
      ro = new ResizeObserver(updateViewport);
      ro.observe(container);
    }

    const onWindowResize = () => updateViewport();
    window.addEventListener("resize", onWindowResize);

    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", onWindowResize);
    };
  }, [updateViewport]);

  const handleScroll = useCallback((e: Event) => {
    const container = e.currentTarget as HTMLDivElement;
    setScrollTop(container.scrollTop);
    setViewportHeight(container.clientHeight);
  }, []);

  const totalHeight = itemCount * rowHeight;
  const startIndex = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
  const endIndex =
    viewportHeight > 0
      ? Math.min(
          itemCount,
          Math.ceil((scrollTop + viewportHeight) / rowHeight) + overscan,
        )
      : Math.min(itemCount, startIndex + overscan * 2);
  const offset = startIndex * rowHeight;

  const scrollToIndex = useCallback(
    (
      index: number,
      block: "start" | "center" | "end" | "nearest" = "nearest",
    ) => {
      const container = containerRef.current;
      if (!container || itemCount === 0) return;

      const clamped = Math.max(0, Math.min(index, itemCount - 1));
      const rowTop = clamped * rowHeight;

      switch (block) {
        case "start": {
          container.scrollTop = rowTop;
          return;
        }
        case "end": {
          container.scrollTop = Math.max(
            0,
            rowTop - container.clientHeight + rowHeight,
          );
          return;
        }
        case "center": {
          container.scrollTop = Math.max(
            0,
            rowTop - container.clientHeight / 2 + rowHeight / 2,
          );
          return;
        }
        case "nearest": {
          const top = container.scrollTop;
          const bottom = top + container.clientHeight;
          if (rowTop < top) {
            container.scrollTop = rowTop;
          } else if (rowTop + rowHeight > bottom) {
            container.scrollTop = Math.max(
              0,
              rowTop - container.clientHeight + rowHeight,
            );
          }
          return;
        }
      }
    },
    [itemCount, rowHeight],
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
