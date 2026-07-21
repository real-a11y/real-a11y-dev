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
      const container = nodeRef.current;
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
