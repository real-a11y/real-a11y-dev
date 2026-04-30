import { describe, it, expect, vi } from "vitest";

import type { FrameTree } from "./frame-merger.js";
import {
  type TabState,
  clearTabFrames,
  createTabState,
  disposeTabState,
  getOrCreateTabState,
  recordFrameTree,
  removeFrame,
} from "./tab-state.js";

function makeFrameTree(frameId: number): FrameTree {
  return {
    frameId,
    frameUrl: `https://example.test/frame-${frameId}`,
    pageTitle: `Frame ${frameId}`,
    nodes: [],
    rootId: `root-${frameId}`,
  };
}

describe("createTabState", () => {
  it("returns an empty state with nulled merge timer", () => {
    const s = createTabState();
    expect(s.frames.size).toBe(0);
    expect(s.nodeToFrame.size).toBe(0);
    expect(s.mergeTimer).toBeNull();
  });
});

describe("getOrCreateTabState", () => {
  it("creates a fresh state on first call and stores it in the registry", () => {
    const reg = new Map<number, TabState>();
    const s = getOrCreateTabState(reg, 7);
    expect(reg.get(7)).toBe(s);
  });

  it("returns the same state on subsequent calls (no double-init)", () => {
    const reg = new Map<number, TabState>();
    const a = getOrCreateTabState(reg, 7);
    a.frames.set(0, makeFrameTree(0));
    const b = getOrCreateTabState(reg, 7);
    expect(b).toBe(a);
    expect(b.frames.size).toBe(1);
  });

  it("isolates state between tabs", () => {
    const reg = new Map<number, TabState>();
    const a = getOrCreateTabState(reg, 1);
    const b = getOrCreateTabState(reg, 2);
    a.frames.set(0, makeFrameTree(0));
    expect(b.frames.size).toBe(0);
  });
});

describe("recordFrameTree", () => {
  it("flags the first top-frame announce as new", () => {
    const s = createTabState();
    expect(recordFrameTree(s, makeFrameTree(0))).toEqual({
      isNewTopFrame: true,
    });
  });

  it("does not flag a re-announce of the top frame as new", () => {
    const s = createTabState();
    recordFrameTree(s, makeFrameTree(0));
    expect(recordFrameTree(s, makeFrameTree(0))).toEqual({
      isNewTopFrame: false,
    });
  });

  it("never flags a subframe announce as new top frame", () => {
    const s = createTabState();
    expect(recordFrameTree(s, makeFrameTree(5))).toEqual({
      isNewTopFrame: false,
    });
    // Even if no top frame exists yet, frameId !== 0 is never "new top".
    expect(s.frames.has(0)).toBe(false);
  });

  it("stores the announced tree under its frame id", () => {
    const s = createTabState();
    const tree = makeFrameTree(3);
    recordFrameTree(s, tree);
    expect(s.frames.get(3)).toBe(tree);
  });
});

describe("clearTabFrames", () => {
  it("empties frames and nodeToFrame but leaves the merge timer alone", () => {
    const s = createTabState();
    s.frames.set(0, makeFrameTree(0));
    s.frames.set(5, makeFrameTree(5));
    s.nodeToFrame.set("abc", 0);
    s.mergeTimer = setTimeout(
      () => {},
      10000,
    ) as unknown as typeof s.mergeTimer;

    clearTabFrames(s);

    expect(s.frames.size).toBe(0);
    expect(s.nodeToFrame.size).toBe(0);
    expect(s.mergeTimer).not.toBeNull(); // intentionally untouched
    if (s.mergeTimer) clearTimeout(s.mergeTimer);
  });
});

describe("removeFrame", () => {
  it("removes the named frame and reports remaining state", () => {
    const s = createTabState();
    s.frames.set(0, makeFrameTree(0));
    s.frames.set(5, makeFrameTree(5));

    expect(removeFrame(s, 5)).toEqual({ shouldRemerge: true });
    expect(s.frames.has(5)).toBe(false);
    expect(s.frames.has(0)).toBe(true);
  });

  it("reports shouldRemerge:false when the last frame is gone", () => {
    const s = createTabState();
    s.frames.set(0, makeFrameTree(0));
    expect(removeFrame(s, 0)).toEqual({ shouldRemerge: false });
  });

  it("is a no-op when the frame was never recorded", () => {
    const s = createTabState();
    s.frames.set(0, makeFrameTree(0));
    expect(removeFrame(s, 99)).toEqual({ shouldRemerge: true });
    expect(s.frames.size).toBe(1);
  });
});

describe("disposeTabState", () => {
  it("clears the merge timer and removes the tab from the registry", () => {
    vi.useFakeTimers();
    try {
      const reg = new Map<number, TabState>();
      const s = getOrCreateTabState(reg, 1);
      const callback = vi.fn();
      // Cross-runtime cast: vitest pulls @types/node so `setTimeout`
      // returns `Timeout` here, while the package's lib resolves the
      // type to `number`. Either is a valid clearTimeout handle.
      s.mergeTimer = setTimeout(
        callback,
        100,
      ) as unknown as typeof s.mergeTimer;

      disposeTabState(reg, 1);

      expect(reg.has(1)).toBe(false);
      vi.advanceTimersByTime(200);
      expect(callback).not.toHaveBeenCalled(); // timer was cleared
    } finally {
      vi.useRealTimers();
    }
  });

  it("is a no-op for tab ids that aren't tracked", () => {
    const reg = new Map<number, TabState>();
    expect(() => disposeTabState(reg, 999)).not.toThrow();
  });
});
