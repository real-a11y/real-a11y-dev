import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { useVirtualTree, type UseVirtualTreeResult } from "./useVirtualTree.js";

/**
 * jsdom gives every element a `clientHeight` of 0 because it does no layout, so
 * the hook could never measure a viewport taller than the overscan fallback.
 * Force `.sn-tree-container` to report a real height so windowing can be
 * exercised the way it behaves in a browser.
 */
const CONTAINER_HEIGHT = 480; // 20 rows at 24px
const ITEM_COUNT = 1000;
const ROW_HEIGHT = 24;

/** Flush Preact's async effect/render chain until `predicate` holds. */
async function waitFor(predicate: () => boolean, timeoutMs = 2000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("Timed out waiting for condition");
}

/**
 * Renders the virtualized rows so tests can count what is actually in the DOM.
 * `connected` gates the scrollable container behind a placeholder, mirroring the
 * extension side panel's "Connecting…" screen that mounts the tree only later.
 */
function Harness({ connected }: { connected: boolean }) {
  const { containerRef, startIndex, endIndex, totalHeight, offset, onScroll } =
    useVirtualTree(ITEM_COUNT, { rowHeight: ROW_HEIGHT });

  if (!connected) return <div class="sn-connecting">Connecting…</div>;

  return (
    <div ref={containerRef} class="sn-tree-container" onScroll={onScroll}>
      <div style={{ minHeight: totalHeight, paddingTop: offset }}>
        {Array.from({ length: endIndex - startIndex }, (_, i) => (
          <div class="sn-row" data-index={startIndex + i}>
            row {startIndex + i}
          </div>
        ))}
      </div>
    </div>
  );
}

describe("useVirtualTree", () => {
  let container: HTMLDivElement;
  let originalClientHeight: PropertyDescriptor | undefined;

  beforeEach(() => {
    originalClientHeight = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "clientHeight",
    );
    Object.defineProperty(HTMLElement.prototype, "clientHeight", {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList?.contains("sn-tree-container")
          ? CONTAINER_HEIGHT
          : 0;
      },
    });

    container = document.createElement("div");
    document.body.appendChild(container);
  });

  afterEach(() => {
    render(null, container);
    container.remove();
    if (originalClientHeight) {
      Object.defineProperty(
        HTMLElement.prototype,
        "clientHeight",
        originalClientHeight,
      );
    } else {
      // @ts-expect-error deleting a jsdom prototype getter we added
      delete HTMLElement.prototype.clientHeight;
    }
  });

  function rowCount(): number {
    return container.querySelectorAll(".sn-row").length;
  }

  it("measures the viewport when the container is mounted from the start", async () => {
    render(<Harness connected={true} />, container);
    // ceil(480 / 24) + overscan(5) = 25 rows, well above the 10-row fallback.
    await waitFor(() => rowCount() > 10);
    expect(rowCount()).toBe(25);
  });

  it("measures the viewport when the container mounts after first render", async () => {
    // Regression: the extension mounts the scrollable list only after it
    // connects. A one-shot mount effect reads a null ref and never re-attaches,
    // leaving viewportHeight at 0 so only the overscan fallback (~10 rows)
    // renders until the user scrolls. The callback ref must measure on mount.
    render(<Harness connected={false} />, container);
    expect(rowCount()).toBe(0);

    render(<Harness connected={true} />, container);
    await waitFor(() => rowCount() > 10);
    expect(rowCount()).toBe(25);
  });

  it("does not render an empty window when the list shrinks while scrolled down", async () => {
    // Regression: after collapse-all / filtering while scrolled down, the saved
    // scrollTop still holds the old large value for a frame. Without clamping,
    // startIndex would exceed the shrunken itemCount and the slice would render
    // empty until the browser corrects the scroll position.
    function ShrinkHarness({ count }: { count: number }) {
      const {
        containerRef,
        startIndex,
        endIndex,
        totalHeight,
        offset,
        onScroll,
      } = useVirtualTree(count, { rowHeight: ROW_HEIGHT });
      return (
        <div ref={containerRef} class="sn-tree-container" onScroll={onScroll}>
          <div style={{ minHeight: totalHeight, paddingTop: offset }}>
            {Array.from({ length: endIndex - startIndex }, (_, i) => (
              <div class="sn-row" data-index={startIndex + i}>
                row {startIndex + i}
              </div>
            ))}
          </div>
        </div>
      );
    }

    render(<ShrinkHarness count={1000} />, container);
    await waitFor(() => rowCount() > 10);

    // Scroll far down the large list.
    const scroller = container.querySelector(
      ".sn-tree-container",
    ) as HTMLDivElement;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      writable: true,
      value: 900 * ROW_HEIGHT,
    });
    scroller.dispatchEvent(new Event("scroll"));
    await waitFor(
      () =>
        Number(container.querySelector(".sn-row")?.getAttribute("data-index")) >
        100,
    );

    // Shrink the list drastically while scrollTop still holds the old value.
    render(<ShrinkHarness count={5} />, container);
    await waitFor(() => rowCount() > 0 && rowCount() <= 5);
    expect(rowCount()).toBe(5);
  });

  it("re-windows synchronously on scrollToIndex without waiting for a scroll event", async () => {
    // Regression: scrollToIndex used to only set container.scrollTop and rely
    // on the async `scroll` event to refresh startIndex/endIndex, so a large
    // jump (cross-link, focus sync, go-to-tree) flashed blank space for a
    // frame while the viewport had already moved. The hook must re-window from
    // its own state update — no scroll event is dispatched here.
    let scrollToIndex: UseVirtualTreeResult["scrollToIndex"] | undefined;
    function JumpHarness() {
      const vt = useVirtualTree(ITEM_COUNT, { rowHeight: ROW_HEIGHT });
      scrollToIndex = vt.scrollToIndex;
      return (
        <div
          ref={vt.containerRef}
          class="sn-tree-container"
          onScroll={vt.onScroll}
        >
          <div style={{ minHeight: vt.totalHeight, paddingTop: vt.offset }}>
            {Array.from({ length: vt.endIndex - vt.startIndex }, (_, i) => (
              <div class="sn-row" data-index={vt.startIndex + i}>
                row {vt.startIndex + i}
              </div>
            ))}
          </div>
        </div>
      );
    }

    render(<JumpHarness />, container);
    await waitFor(() => rowCount() > 10);

    // jsdom's scrollTop setter is inert; make it hold assigned values the way
    // a real scroll box does.
    const scroller = container.querySelector(
      ".sn-tree-container",
    ) as HTMLDivElement;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });

    scrollToIndex!(900, "start");
    await waitFor(
      () =>
        Number(container.querySelector(".sn-row")?.getAttribute("data-index")) >
        800,
    );
    // scrollTop = 900 rows × 24px → startIndex = 900 − overscan(5).
    expect(
      Number(container.querySelector(".sn-row")?.getAttribute("data-index")),
    ).toBe(895);
  });

  it("accounts for the container's top padding when scrolling a row into view", async () => {
    // Regression: `.sn-tree-container` has `padding: 4px 0`, so row i really
    // occupies [padTop + i*rh, padTop + (i+1)*rh] in scroll coordinates. A
    // downward "nearest" reveal computed from i*rh alone lands short by the
    // padding and clips the row's bottom edge (the pre-virtualization
    // scrollIntoView measured the real element, so it never had this bug).
    const PAD_TOP = 4;
    let scrollToIndex: UseVirtualTreeResult["scrollToIndex"] | undefined;
    function PaddedHarness() {
      const vt = useVirtualTree(ITEM_COUNT, { rowHeight: ROW_HEIGHT });
      scrollToIndex = vt.scrollToIndex;
      return (
        <div
          ref={vt.containerRef}
          class="sn-tree-container"
          style={{ padding: `${PAD_TOP}px 0` }}
          onScroll={vt.onScroll}
        >
          <div style={{ minHeight: vt.totalHeight, paddingTop: vt.offset }}>
            {Array.from({ length: vt.endIndex - vt.startIndex }, (_, i) => (
              <div class="sn-row" data-index={vt.startIndex + i}>
                row {vt.startIndex + i}
              </div>
            ))}
          </div>
        </div>
      );
    }

    render(<PaddedHarness />, container);
    await waitFor(() => rowCount() > 10);

    const scroller = container.querySelector(
      ".sn-tree-container",
    ) as HTMLDivElement;
    Object.defineProperty(scroller, "scrollTop", {
      configurable: true,
      writable: true,
      value: 0,
    });

    // Row 50 sits below the viewport; "nearest" must align its bottom with
    // the viewport bottom: padTop + (50 + 1) * 24 - 480.
    scrollToIndex!(50, "nearest");
    expect(scroller.scrollTop).toBe(
      PAD_TOP + 51 * ROW_HEIGHT - CONTAINER_HEIGHT,
    );
  });

  it("re-measures when the container unmounts and remounts", async () => {
    render(<Harness connected={true} />, container);
    await waitFor(() => rowCount() > 10);

    render(<Harness connected={false} />, container);
    await waitFor(() => rowCount() === 0);

    render(<Harness connected={true} />, container);
    await waitFor(() => rowCount() > 10);
    expect(rowCount()).toBe(25);
  });

  it("returns a stable containerRef across renders", async () => {
    const refs: UseVirtualTreeResult["containerRef"][] = [];
    function Capture() {
      const { containerRef } = useVirtualTree(ITEM_COUNT);
      const [, setTick] = useState(0);
      refs.push(containerRef);
      useEffect(() => {
        setTick((t) => t + 1);
      }, []);
      return null;
    }
    render(<Capture />, container);
    await waitFor(() => refs.length >= 2);
    expect(refs[0]).toBe(refs[refs.length - 1]);
  });

  it("keeps scrollToIndex identity stable when itemCount changes", async () => {
    // Consumers key their "scroll selection into view" effect on scrollToIndex
    // so it fires only on selection change. If scrollToIndex changed identity
    // whenever the visible-row count changed (expand/collapse), that effect
    // would re-run and yank the viewport back to the selection.
    const fns: UseVirtualTreeResult["scrollToIndex"][] = [];
    function Capture({ count }: { count: number }) {
      const { scrollToIndex } = useVirtualTree(count);
      fns.push(scrollToIndex);
      return null;
    }
    render(<Capture count={1000} />, container);
    render(<Capture count={3} />, container);
    render(<Capture count={5000} />, container);
    expect(fns.length).toBeGreaterThanOrEqual(3);
    expect(fns[0]).toBe(fns[fns.length - 1]);
  });
});
