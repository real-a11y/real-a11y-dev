import type { SemanticNode } from "@real-a11y-dev/core";
import { describe, it, expect, vi } from "vitest";

import type { FrameTree } from "./frame-merger.js";
import { MAX_MARKED_FRAMES } from "./frame-owner.js";
import {
  type TabState,
  answeredPlacesAskedOf,
  clearTabFrames,
  createTabState,
  disposeTabState,
  forgetAskedPlaces,
  framesToMerge,
  getOrCreateTabState,
  holdsSkeleton,
  publishedTree,
  recordFrameTree,
  removeFrame,
  unplaceableFrames,
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
    expect(s.recoveryChecked).toBe(false);
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

  it("leaves the worker-scoped recovery flag alone", () => {
    // Deliberate: re-arming per clear would fire on every panel REQUEST_TREE
    // too. See the doc block on clearTabFrames for what that costs and what
    // it gives up.
    const s = createTabState();
    s.recoveryChecked = true;
    clearTabFrames(s);
    expect(s.recoveryChecked).toBe(true);
  });

  it("keeps what was learned of frames' places: a fresh request is for the same page", () => {
    // The panel asks for the tree again after every action. Forgetting here
    // would have each frame found to have no place waited on, and its
    // parent's document read, all over again each time.
    const s = createTabState();
    s.askedPlaces.set(5, {
      mark: "mark-a",
      since: 0,
      asked: true,
      parent: 0,
      answered: true,
    });
    clearTabFrames(s);
    expect(s.askedPlaces.size).toBe(1);
    // A navigation's frames are all new.
    forgetAskedPlaces(s);
    expect(s.askedPlaces.size).toBe(0);
  });
});

describe("disposeTabState: the check on unplaced frames", () => {
  it("cancels it with the tab", () => {
    vi.useFakeTimers();
    try {
      const registry = new Map<number, TabState>();
      const s = getOrCreateTabState(registry, 7);
      const check = vi.fn();
      s.placeTimer = setTimeout(check, 1_500) as unknown as typeof s.placeTimer;
      disposeTabState(registry, 7);
      vi.advanceTimersByTime(5_000);
      expect(check).not.toHaveBeenCalled();
      expect(registry.has(7)).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("frames found to have no place in the tree", () => {
  const waiting = (owner: string) => ({ ...makeFrameTree(5), owner });

  it("are the ones asked after whose parent has sent its tree since", () => {
    const s = createTabState();
    s.frames.set(5, waiting("mark-a"));
    s.askedPlaces.set(5, {
      mark: "mark-a",
      since: 0,
      asked: true,
      parent: 2,
      answered: false,
    });
    expect([...unplaceableFrames(s)]).toEqual([]);
    // Another frame's tree says nothing of it.
    answeredPlacesAskedOf(s, 0);
    expect([...unplaceableFrames(s)]).toEqual([]);
    answeredPlacesAskedOf(s, 2);
    expect([...unplaceableFrames(s)]).toEqual([5]);
  });

  it("aren't ones still waiting to be asked after", () => {
    const s = createTabState();
    s.frames.set(5, waiting("mark-a"));
    s.askedPlaces.set(5, {
      mark: "mark-a",
      since: 0,
      asked: false,
      parent: 2,
      answered: false,
    });
    // The parent's tree, before anyone asked it: it may predate the mark.
    answeredPlacesAskedOf(s, 2);
    expect([...unplaceableFrames(s)]).toEqual([]);
  });

  it("aren't ones whose parent reported as many marks as a report carries", () => {
    // Past that many, a mark the parent's tree does bear goes unreported:
    // the frame may have a node after all.
    const s = createTabState();
    s.frames.set(5, waiting("mark-a"));
    s.frames.set(2, {
      ...makeFrameTree(2),
      embeds: Array.from(
        { length: MAX_MARKED_FRAMES },
        (_, i) => [`sn-${i}`, `mark-${i}`] as [string, string],
      ),
    });
    s.askedPlaces.set(5, {
      mark: "mark-a",
      since: 0,
      asked: true,
      parent: 2,
      answered: true,
    });
    expect([...unplaceableFrames(s)]).toEqual([]);
  });

  it("aren't ones that have come back with another mark", () => {
    const s = createTabState();
    s.frames.set(5, waiting("mark-next"));
    s.askedPlaces.set(5, {
      mark: "mark-a",
      since: 0,
      asked: true,
      parent: 2,
      answered: true,
    });
    expect([...unplaceableFrames(s)]).toEqual([]);
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

  it("forgets that the frame's place was asked after, and no other frame's", () => {
    const s = createTabState();
    s.frames.set(0, makeFrameTree(0));
    const entry = { since: 0, parent: 0, answered: false };
    s.askedPlaces.set(5, { ...entry, mark: "mark-a", asked: true });
    s.askedPlaces.set(6, { ...entry, mark: "mark-b", asked: false });
    removeFrame(s, 5);
    expect([...s.askedPlaces.keys()]).toEqual([6]);
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

describe("holdsSkeleton", () => {
  /** The frames Chrome lists. */
  const live = (...frameIds: number[]) =>
    new Map(frameIds.map((id) => [id, { parentFrameId: 0, url: "" }]));
  const skeletonOf = (frameId: number): FrameTree => ({
    ...makeFrameTree(frameId),
    framesOnly: true,
  });

  it("is false while every frame sent its tree", () => {
    const s = createTabState();
    s.frames.set(0, makeFrameTree(0));
    s.frames.set(1, makeFrameTree(1));
    expect(holdsSkeleton(s, live(0, 1))).toBe(false);
  });

  it("is true while the top frame sent its skeleton", () => {
    const s = createTabState();
    s.frames.set(0, skeletonOf(0));
    s.frames.set(1, makeFrameTree(1));
    expect(holdsSkeleton(s, live(0, 1))).toBe(true);
    // Whatever Chrome lists: the top frame is the page.
    expect(holdsSkeleton(s, live())).toBe(true);
  });

  it("is true while a frame Chrome lists sent its skeleton", () => {
    const s = createTabState();
    s.frames.set(0, makeFrameTree(0));
    s.frames.set(3, skeletonOf(3));
    expect(holdsSkeleton(s, live(0, 3))).toBe(true);
  });

  it("is true while a frame Chrome doesn't list, but its mark places, sent its skeleton", () => {
    // Chrome lists no `javascript:` frame, though the content script runs
    // in one: the element bearing its mark is in the page's tree.
    const s = createTabState();
    s.frames.set(0, { ...makeFrameTree(0), embeds: [["if-js", "mark-js"]] });
    s.frames.set(4, { ...skeletonOf(4), owner: "mark-js" });
    expect(holdsSkeleton(s, live(0))).toBe(true);
  });

  it("leaves out a frame Chrome no longer lists, which sends nothing again", () => {
    const s = createTabState();
    s.frames.set(0, makeFrameTree(0));
    s.frames.set(3, skeletonOf(3));
    expect(holdsSkeleton(s, live(0))).toBe(false);
  });
});

describe("framesToMerge", () => {
  const live = (...frameIds: number[]) =>
    new Map(frameIds.map((id) => [id, { parentFrameId: 0, url: "" }]));

  it("leaves out the skeleton of a frame Chrome no longer lists, and nothing else", () => {
    const s = createTabState();
    s.frames.set(0, { ...makeFrameTree(0), framesOnly: true });
    s.frames.set(1, { ...makeFrameTree(1), framesOnly: true });
    s.frames.set(2, { ...makeFrameTree(2), framesOnly: true });
    // A frame's tree is merged in its turn whether Chrome lists it or not.
    s.frames.set(3, makeFrameTree(3));
    expect([...framesToMerge(s, live(1)).keys()]).toEqual([0, 1, 3]);
    // The tab's own record of its frames is left alone.
    expect(s.frames.size).toBe(4);
  });

  it("leaves out the skeletons of a removed frame and of the frames inside it, which only its last tree places", () => {
    // Frame 5's <iframe>, holding frame 6's, is gone from the page's tree,
    // and Chrome lists neither: frame 5's last skeleton still bears 6's mark.
    const s = createTabState();
    s.frames.set(0, makeFrameTree(0));
    s.frames.set(5, {
      ...makeFrameTree(5),
      owner: "mark-5",
      embeds: [["if-6", "mark-6"]],
      framesOnly: true,
    });
    s.frames.set(6, { ...makeFrameTree(6), owner: "mark-6", framesOnly: true });
    expect([...framesToMerge(s, live()).keys()]).toEqual([0]);
    expect(holdsSkeleton(s, live())).toBe(false);
    // While the page's tree bears frame 5's mark, both are in the page.
    s.frames.set(0, { ...makeFrameTree(0), embeds: [["if-5", "mark-5"]] });
    expect([...framesToMerge(s, live()).keys()]).toEqual([0, 5, 6]);
    expect(holdsSkeleton(s, live())).toBe(true);
  });

  it("keeps the skeleton of a frame Chrome doesn't list while its mark places it", () => {
    const s = createTabState();
    s.frames.set(0, { ...makeFrameTree(0), embeds: [["if-js", "mark-js"]] });
    s.frames.set(4, {
      ...makeFrameTree(4),
      owner: "mark-js",
      framesOnly: true,
    });
    expect([...framesToMerge(s, live()).keys()]).toEqual([0, 4]);
    // Once the page's tree bears the mark no more, its <iframe> is gone.
    s.frames.set(0, makeFrameTree(0));
    expect([...framesToMerge(s, live()).keys()]).toEqual([0]);
  });
});

describe("publishedTree", () => {
  function node(
    id: string,
    parentId: string | null,
    isExposedToAT = true,
  ): SemanticNode {
    return {
      id,
      parentId,
      childIds: [],
      depth: parentId === null ? 0 : 1,
      a11y: {
        role: "generic",
        name: "",
        description: "",
        states: {},
        properties: {},
        isExposedToAT,
      },
    };
  }

  /** The page, frame 1 under an <iframe> it shows and frame 2 under one it
   *  hides, as merged. */
  function page() {
    const state = createTabState();
    const topFrame = makeFrameTree(0);
    state.frames.set(0, topFrame);
    state.frames.set(1, makeFrameTree(1));
    state.frames.set(2, makeFrameTree(2));
    const merged = [
      node("root-0", null),
      node("shown", "root-0"),
      node("hidden", "root-0", false),
      node("f1-root-1", "shown"),
      node("f2-root-2", "hidden"),
    ];
    const result = {
      nodes: new Map(merged.map((n) => [n.id, n])),
      nodeToFrame: new Map<string, number>(),
      unplaced: [],
    };
    const listed = new Map(
      [0, 1, 2].map((id) => [id, { parentFrameId: 0, url: "" }]),
    );
    return { state, topFrame, result, listed };
  }

  it("is the merged tree, with the top frame's title and URL, for the tab", () => {
    const { state, topFrame, result, listed } = page();
    const message = publishedTree(state, result, {
      tabId: 7,
      topFrame,
      changed: new Map(),
      listed,
    });
    expect(message).toEqual({
      type: "TREE_DATA",
      tabId: 7,
      payload: {
        nodes: [...result.nodes.entries()],
        rootId: "root-0",
        pageTitle: "Frame 0",
        pageUrl: "https://example.test/frame-0",
      },
    });
  });

  it("says when the top frame and each frame the page shows changed, earliest first, and takes each off the tab's changes", () => {
    const { state, topFrame, result, listed } = page();
    const changed = new Map([
      [1, 3_000],
      [2, 1_000],
      [0, 2_000],
    ]);
    for (const [frameId, at] of changed) state.changedFrames.set(frameId, at);
    const message = publishedTree(state, result, {
      tabId: 7,
      topFrame,
      changed,
      listed,
    });
    // The hidden frame's change prompts nothing, and is answered for.
    expect(message.payload.pageChangedAt).toEqual([2_000, 3_000]);
    expect(state.changedFrames.size).toBe(0);
  });

  it("says the tree is a skeleton while a frame sent its skeleton", () => {
    const { state, topFrame, result, listed } = page();
    state.frames.set(2, { ...makeFrameTree(2), framesOnly: true });
    const at = { tabId: 7, topFrame, changed: new Map(), listed };
    expect(publishedTree(state, result, at).payload.framesOnly).toBe(true);
    state.frames.set(2, makeFrameTree(2));
    expect(publishedTree(state, result, at).payload).not.toHaveProperty(
      "framesOnly",
    );
  });
});
