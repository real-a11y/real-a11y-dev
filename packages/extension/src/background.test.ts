/**
 * Background service-worker integration tests.
 *
 * Unlike ./routing and ./tab-state, `background.ts` is not a pure module — it
 * is the wiring between Chrome's event listeners, and some behaviour (what a
 * whole tab's frames are asked to do, and what the panel ends up rendering) is
 * only observable at that level. These tests stand up a fake `chrome` whose
 * frames answer the way real content scripts do, then drive the real module
 * through it.
 */

import type { SemanticNode } from "@real-a11y-dev/core";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// ---- Fixtures -----------------------------------------------------------

function makeNode(
  id: string,
  partial: Partial<SemanticNode> & {
    tagName?: string;
    attrs?: Record<string, string>;
  } = {},
): SemanticNode {
  return {
    id,
    parentId: partial.parentId ?? null,
    childIds: partial.childIds ?? [],
    depth: partial.depth ?? 0,
    dom: {
      tagName: partial.tagName ?? "div",
      attributes: partial.attrs ?? {},
      textContent: null,
      descendantText: "",
      isHidden: false,
    },
    a11y: {
      role: "generic",
      name: "",
      description: "",
      states: {},
      properties: {},
      isExposedToAT: true,
    },
    interaction: {
      isInteractive: false,
      actions: [],
      isFocusable: false,
      isEditable: false,
    },
    ui: {
      expanded: false,
      highlighted: false,
      matchesFilter: false,
      selected: false,
    },
  };
}

const TAB_ID = 42;
const TOP_URL = "https://top.test/page";
const CHILD_A_URL = "https://a.test/widget";
const CHILD_B_URL = "https://b.test/widget";

/** A top frame with two iframes, as `chrome.webNavigation` reports it. */
const PAGE_FRAMES = [
  { frameId: 0, parentFrameId: -1, url: TOP_URL },
  { frameId: 1, parentFrameId: 0, url: CHILD_A_URL },
  { frameId: 2, parentFrameId: 0, url: CHILD_B_URL },
];

/** What each frame's content script announces when it extracts. */
function frameTreePayload(frameId: number) {
  if (frameId === 0) {
    return {
      frameUrl: TOP_URL,
      pageTitle: "Top",
      rootId: "root",
      nodes: [
        ["root", makeNode("root", { childIds: ["ifA", "ifB"] })],
        [
          "ifA",
          makeNode("ifA", {
            parentId: "root",
            depth: 1,
            tagName: "iframe",
            attrs: { src: CHILD_A_URL },
          }),
        ],
        [
          "ifB",
          makeNode("ifB", {
            parentId: "root",
            depth: 1,
            tagName: "iframe",
            attrs: { src: CHILD_B_URL },
          }),
        ],
      ] as Array<[string, SemanticNode]>,
    };
  }
  return {
    frameUrl: frameId === 1 ? CHILD_A_URL : CHILD_B_URL,
    pageTitle: `Frame ${frameId}`,
    rootId: "root",
    nodes: [["root", makeNode("root")]] as Array<[string, SemanticNode]>,
  };
}

// ---- Fake chrome --------------------------------------------------------

const EXTENSION_ID = "test-extension-id";

interface SentTabMessage {
  tabId: number;
  frameId?: number;
  body: { type: string; payload?: unknown };
}

type MessageListener = (
  message: { type: string; payload?: unknown; tabId?: number },
  sender: { id?: string; tab?: { id: number }; frameId?: number },
  sendResponse: (response?: unknown) => void,
) => unknown;

type ConnectListener = (port: unknown) => void;

type NavigateListener = (details: { tabId: number; frameId: number }) => void;

type RemovedListener = (tabId: number) => void;

/**
 * Knobs, not constants. Each of these is a dimension along which the real
 * thing varies and the recovery can fail: how long a frame takes to answer,
 * whether it can answer at all, what Chrome reports, and whether a send
 * errored. Pinning any of them to the happy value makes the matching test
 * unfailable, so they are per-test.
 */
function makeHarness() {
  const tabMessages: SentTabMessage[] = [];
  const panelMessages: Array<{ type: string; [k: string]: unknown }> = [];
  const messageListeners: MessageListener[] = [];
  const connectListeners: ConnectListener[] = [];
  const navigateListeners: NavigateListener[] = [];
  const removedListeners: RemovedListener[] = [];
  /** Frames whose content script is loaded and will answer. Reducible. */
  const liveFrames = new Set(PAGE_FRAMES.map((f) => f.frameId));
  /** What `chrome.webNavigation.getAllFrames` reports. Settable. */
  const knobs = {
    frames: [...PAGE_FRAMES] as Array<{
      frameId: number;
      parentFrameId: number;
      url: string;
    }>,
    /** How long a pinged frame takes to answer, in ms. */
    answerDelayMs: 0,
    /** How long `getAllFrames` takes to resolve, in ms. */
    getAllFramesDelayMs: 0,
    /** `chrome.runtime.lastError` seen by a `tabs.sendMessage` callback. */
    sendError: undefined as undefined | { message: string },
  };

  const noopEvent = () => ({ addListener: () => {} });

  const chromeMock = {
    runtime: {
      id: EXTENSION_ID,
      lastError: undefined as undefined | { message: string },
      onMessage: {
        addListener: (fn: MessageListener) => messageListeners.push(fn),
      },
      onConnect: {
        addListener: (fn: ConnectListener) => connectListeners.push(fn),
      },
      sendMessage: (msg: { type: string }) => {
        panelMessages.push(msg);
        return Promise.resolve();
      },
    },
    action: { onClicked: noopEvent() },
    sidePanel: {
      setPanelBehavior: () => Promise.resolve(),
      open: () => Promise.resolve(),
    },
    windows: { WINDOW_ID_NONE: -1, onFocusChanged: noopEvent() },
    webNavigation: {
      onBeforeNavigate: {
        addListener: (fn: NavigateListener) => navigateListeners.push(fn),
      },
      getAllFrames: () =>
        knobs.getAllFramesDelayMs === 0
          ? Promise.resolve(knobs.frames)
          : new Promise((resolve) =>
              setTimeout(
                () => resolve(knobs.frames),
                knobs.getAllFramesDelayMs,
              ),
            ),
    },
    tabs: {
      onActivated: noopEvent(),
      onRemoved: {
        addListener: (fn: RemovedListener) => removedListeners.push(fn),
      },
      query: () => Promise.resolve([{ id: TAB_ID, windowId: 1 }]),
      sendMessage: (
        tabId: number,
        body: { type: string; payload?: unknown },
        optsOrCb?: { frameId?: number } | (() => void),
        maybeCb?: () => void,
      ) => {
        const opts = typeof optsOrCb === "function" ? undefined : optsOrCb;
        const cb = typeof optsOrCb === "function" ? optsOrCb : maybeCb;
        tabMessages.push({ tabId, frameId: opts?.frameId, body });

        // Real Chrome invokes the callback on a later turn, with
        // `lastError` set when the frame had no receiver.
        setTimeout(() => {
          chromeMock.runtime.lastError = knobs.sendError;
          try {
            cb?.();
          } finally {
            chromeMock.runtime.lastError = undefined;
          }
        }, 0);

        // The addressed content script(s) act on it. Anything that makes a
        // real one call `sendTree()` announces back after the round trip.
        if (!RE_ANNOUNCE_TRIGGERS.has(body.type)) return;
        // `chrome.tabs.sendMessage` reaches every frame in the tab unless
        // `options.frameId` names one.
        const targets =
          opts?.frameId === undefined
            ? knobs.frames.map((f) => f.frameId)
            : [opts.frameId];
        for (const frameId of targets) {
          if (!liveFrames.has(frameId)) continue;
          setTimeout(() => announce(harness, frameId), knobs.answerDelayMs);
        }
      },
    },
  };

  const harness = {
    chromeMock,
    tabMessages,
    panelMessages,
    messageListeners,
    connectListeners,
    navigateListeners,
    removedListeners,
    liveFrames,
    knobs,
  };
  return harness;
}

type Harness = ReturnType<typeof makeHarness>;

/** Deliver a `FRAME_TREE_DATA` to the background as frame `frameId` would. */
function announce(h: Harness, frameId: number) {
  for (const fn of h.messageListeners) {
    fn(
      { type: "FRAME_TREE_DATA", payload: frameTreePayload(frameId) },
      { id: EXTENSION_ID, tab: { id: TAB_ID }, frameId },
      () => {},
    );
  }
}

/** Simulate the side panel connecting its port to the worker. */
function connectPanel(h: Harness) {
  for (const fn of h.connectListeners) {
    fn({ name: "sidepanel", onDisconnect: { addListener: () => {} } });
  }
}

/** Simulate `chrome.webNavigation.onBeforeNavigate` for the top frame. */
function beginTopFrameNavigation(h: Harness) {
  for (const fn of h.navigateListeners) fn({ tabId: TAB_ID, frameId: 0 });
}

/** Simulate `chrome.tabs.onRemoved`. */
function removeTab(h: Harness) {
  for (const fn of h.removedListeners) fn(TAB_ID);
}

/** Messages of one type the background sent to the tab since `from`. */
function sentSince(h: Harness, from: number, type: string): SentTabMessage[] {
  return h.tabMessages.slice(from).filter((m) => m.body.type === type);
}

/**
 * Messages that make a real content script call `sendTree()`.
 *
 * `SET_OBSERVING` is deliberately absent: `startObserving()` early-returns
 * when the frame is already observing — exactly the state of a page that was
 * already loaded when the service worker restarted — so re-asserting it
 * produces no tree. That no-op is why the existing panel-connect re-arm does
 * not cover the restart case.
 */
const RE_ANNOUNCE_TRIGGERS = new Set([
  "REQUEST_TREE",
  "RESEND_TREE",
  "SET_VIEW_MODE",
]);

/** Re-announce requests the background sent since the `from` mark. */
function reAnnounceRequests(h: Harness, from: number): SentTabMessage[] {
  return h.tabMessages
    .slice(from)
    .filter((m) => RE_ANNOUNCE_TRIGGERS.has(m.body.type));
}

function lastTreeToPanel(h: Harness): string[] | null {
  const treeData = h.panelMessages.filter((m) => m.type === "TREE_DATA");
  if (treeData.length === 0) return null;
  const last = treeData[treeData.length - 1] as unknown as {
    payload: { nodes: Array<[string, SemanticNode]> };
  };
  return last.payload.nodes.map(([id]) => id);
}

// ---- Tests --------------------------------------------------------------

describe("background: recovery after a service-worker restart", () => {
  let h: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    h = makeHarness();
    (globalThis as { chrome?: unknown }).chrome = h.chromeMock;
    await import("./background.js");
    // Let the import-time active-tab query settle, then start from a clean
    // slate so assertions only see what the test itself provoked.
    await vi.runAllTimersAsync();
    h.panelMessages.length = 0;
    h.tabMessages.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  /**
   * A revived worker has an empty `tabStates`, but the page it left behind is
   * still loaded and its content scripts are still observing. They re-announce
   * only when their own DOM mutates, so the first frame to mutate repopulates
   * its tree alone — and the merge that follows hands the panel a tree with
   * every iframe subtree missing.
   */
  it("sends the panel a complete tree when only the top frame re-announces", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    // Frame 0's DOM mutates and it announces. Frames 1 and 2 have no reason to.
    announce(h, 0);
    await vi.runAllTimersAsync();

    const ids = lastTreeToPanel(h);
    expect(ids).not.toBeNull();
    expect(ids).toContain("f1-root");
    expect(ids).toContain("f2-root");
  });

  it("does not keep asking for re-announces once frames are known", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    announce(h, 0);
    await vi.runAllTimersAsync();

    // Steady state: a later mutation in a known frame must not re-trigger the
    // recovery, or every keystroke on the page would re-extract every frame.
    const before = h.tabMessages.length;
    announce(h, 0);
    await vi.runAllTimersAsync();

    expect(reAnnounceRequests(h, before)).toEqual([]);
  });

  /**
   * The counterpart of the restart case: on an ordinary panel open every frame
   * is armed at once and announces within milliseconds, so by the time the
   * merge runs nothing is missing and nobody should be asked to extract twice.
   */
  it("asks nobody to re-announce when every frame already has", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    const before = h.tabMessages.length;
    for (const frameId of [0, 1, 2]) announce(h, frameId);
    await vi.runAllTimersAsync();

    expect(reAnnounceRequests(h, before)).toEqual([]);

    const ids = lastTreeToPanel(h);
    expect(ids).toContain("f1-root");
    expect(ids).toContain("f2-root");
  });

  it("asks only the frames whose trees are actually missing", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    const before = h.tabMessages.length;
    // Frame 1 happens to have mutated too; only frame 2 is still unknown.
    announce(h, 0);
    announce(h, 1);
    await vi.runAllTimersAsync();

    expect(reAnnounceRequests(h, before).map((m) => m.frameId)).toEqual([2]);
  });

  /**
   * The panel rebuilds its node map from each TREE_DATA, so a half-known tree
   * costs the user their expanded rows, selection and scope. Frames that
   * answer inside the merge debounce are held for — the common case.
   */
  it("publishes no half-known tree when the missing frames answer in time", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    h.knobs.answerDelayMs = 20;

    announce(h, 0);
    await vi.runAllTimersAsync();

    const trees = h.panelMessages.filter((m) => m.type === "TREE_DATA");
    expect(trees.length).toBeGreaterThan(0);
    for (const tree of trees) {
      const ids = (
        tree as unknown as { payload: { nodes: Array<[string, SemanticNode]> } }
      ).payload.nodes.map(([id]) => id);
      expect(ids).toContain("f1-root");
      expect(ids).toContain("f2-root");
    }
  });

  /**
   * The deferral is one debounce, not a wait on the frames, so a frame slower
   * than it is published without and completes the tree when its answer
   * lands. Pinned here as the known limit of the current mechanism rather
   * than left to be discovered: closing it needs a per-frame pending set with
   * its own deadline.
   */
  it("still completes the tree when a frame answers slower than the debounce", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    h.knobs.answerDelayMs = 260;

    announce(h, 0);
    await vi.runAllTimersAsync();

    const ids = lastTreeToPanel(h);
    expect(ids).toContain("f1-root");
    expect(ids).toContain("f2-root");
  });

  /**
   * A frame that cannot host a content script — `about:blank`, `srcdoc`,
   * sandboxed, a PDF — is reported by `getAllFrames` and never answers. It
   * must not hold the panel's tree back, or an ordinary page with an ad slot
   * pays the wait forever.
   */
  it("publishes without waiting on a frame that can never answer", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    h.knobs.frames = [
      ...PAGE_FRAMES,
      { frameId: 9, parentFrameId: 0, url: "about:blank" },
    ];
    h.liveFrames.delete(9); // no content script, will never announce

    announce(h, 0);
    await vi.runAllTimersAsync();

    const ids = lastTreeToPanel(h);
    expect(ids).toContain("f1-root");
    expect(ids).toContain("f2-root");
  });

  /**
   * A top-frame navigation empties `frames` while `getAllFrames` still
   * describes the outgoing document, whose subframes are typically still
   * alive and mutating. Soliciting them would republish the page the user
   * just left — `content.ts` documents the hazard: node ids are a per-frame
   * counter, so a stale tree's ids resolve to unrelated live elements.
   */
  it("does not solicit or republish the outgoing page during a navigation", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    announce(h, 0);
    await vi.runAllTimersAsync();
    h.panelMessages.length = 0;

    beginTopFrameNavigation(h);
    const before = h.tabMessages.length;

    // The outgoing page's subframe is still animating and announces.
    announce(h, 1);
    await vi.runAllTimersAsync();

    expect(reAnnounceRequests(h, before)).toEqual([]);
    expect(h.panelMessages.filter((m) => m.type === "TREE_DATA")).toEqual([]);
  });

  /**
   * `planFrameAnnouncementResponse` re-applies the curtain only when
   * `isNewTopFrame`, which is `frameId === 0 && !state.frames.has(0)`. If
   * anything puts frame 0 back into the map during a navigation, the new
   * document's announce no longer reads as new and the curtain silently
   * fails to re-apply — with the UI still reporting it as on, and this
   * extension's own users the ones left looking at an uncovered screen.
   */
  it("re-applies the curtain on the new page after a navigation", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    // Turn the curtain on for the tab, the way the panel does.
    for (const fn of h.messageListeners) {
      fn(
        { type: "TOGGLE_CURTAIN", tabId: TAB_ID, payload: { visible: true } },
        { id: EXTENSION_ID },
        () => {},
      );
    }
    announce(h, 0);
    await vi.runAllTimersAsync();

    beginTopFrameNavigation(h);
    // The outgoing page's subframe announces while the new document loads.
    announce(h, 1);
    await vi.runAllTimersAsync();

    const before = h.tabMessages.length;
    announce(h, 0); // the NEW document's top frame
    await vi.runAllTimersAsync();

    expect(sentSince(h, before, "TOGGLE_CURTAIN").length).toBeGreaterThan(0);
  });

  /**
   * The same window as the test above, but entered *during* the merge's
   * `await getAllFrames()`. A pre-await check cannot see this one — the map
   * is emptied after it passed — so the recovery would still solicit and
   * republish the outgoing page.
   */
  it("does not solicit the outgoing page when the navigation lands mid-merge", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    // The tab's one shot has to still be unspent when the window opens, so
    // this is the tab's first merge — no settled merge before it.
    h.knobs.getAllFramesDelayMs = 100;
    const before = h.tabMessages.length;
    announce(h, 0);

    // Debounce fires at 200ms; the merge is then parked on getAllFrames.
    await vi.advanceTimersByTimeAsync(250);
    beginTopFrameNavigation(h);
    await vi.runAllTimersAsync();

    // With the map emptied under it, the merge must not solicit anyone —
    // every frame now reads as missing, including the top one.
    expect(reAnnounceRequests(h, before)).toEqual([]);
    expect(h.panelMessages.filter((m) => m.type === "TREE_DATA")).toEqual([]);
  });

  /**
   * A subframe mid-navigation is still reported by `getAllFrames` and its
   * outgoing document still answers. Soliciting it would reinstate the very
   * tree `removeFrame` just chose to drop.
   */
  it("does not solicit a subframe whose tree was deliberately dropped", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    // Only frame 0 has announced, so the shot is still unspent and frame 1
    // is about to navigate.
    announce(h, 0);
    const before = h.tabMessages.length;
    for (const fn of h.navigateListeners) fn({ tabId: TAB_ID, frameId: 1 });
    await vi.runAllTimersAsync();

    expect(reAnnounceRequests(h, before).map((m) => m.frameId)).not.toContain(
      1,
    );
  });

  /**
   * `scheduleMerge` used to resolve the tab state by id through
   * `getOrCreateTabState`, which inserts on miss. Now that a merge can
   * re-enter it after an `await`, one still in flight when the tab closes
   * would resurrect the entry — and `onRemoved`, the only deleter, will
   * never fire for that id again.
   */
  it("does not resurrect tab state for a tab that has been closed", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    // Force the deferral path (frame 2 silent), then close the tab while the
    // merge that would re-schedule is still in flight.
    h.liveFrames.delete(2);
    h.knobs.getAllFramesDelayMs = 50;
    announce(h, 0);
    await vi.advanceTimersByTimeAsync(220);
    removeTab(h);
    await vi.runAllTimersAsync();

    const before = h.tabMessages.length;
    await vi.advanceTimersByTimeAsync(2000);
    expect(h.tabMessages.length).toBe(before);
  });

  it("stays quiet when no panel is connected, without spending the one shot", async () => {
    announce(h, 0);
    await vi.runAllTimersAsync();
    expect(reAnnounceRequests(h, 0)).toEqual([]);

    // The worker can be woken by a content script before the panel's port
    // reconnects. That must not burn the tab's one recovery attempt.
    connectPanel(h);
    const before = h.tabMessages.length;
    announce(h, 0);
    await vi.runAllTimersAsync();

    expect(reAnnounceRequests(h, before).map((m) => m.frameId)).toEqual([1, 2]);
  });
});
