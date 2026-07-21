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
});
