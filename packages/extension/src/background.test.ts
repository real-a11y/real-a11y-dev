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

  // Minimal in-memory StorageArea — background.ts now registers native mode
  // unconditionally (the capability ships in every build; a separate
  // runtime setting, not this stub, keeps it off by default), which
  // constructs a NativeDebuggerSession needing `chrome.storage.local`/
  // `.session` to exist even though nothing in this file's own tests
  // exercises native mode itself.
  function fakeStorageArea() {
    const data: Record<string, unknown> = {};
    return {
      get: (k: string) => Promise.resolve(k in data ? { [k]: data[k] } : {}),
      set: (i: Record<string, unknown>) => {
        Object.assign(data, i);
        return Promise.resolve();
      },
    };
  }

  const chromeMock = {
    storage: { local: fakeStorageArea(), session: fakeStorageArea() },
    // NativeDebuggerSession's constructor registers `onDetach` unconditionally
    // now that `registerNativeMode()` always runs; this file's tests never
    // attach a debugger themselves, so `attach`/`detach`/`sendCommand` just
    // need to exist and resolve, not do anything realistic.
    debugger: {
      onDetach: noopEvent(),
      attach: () => Promise.resolve(),
      detach: () => Promise.resolve(),
      sendCommand: () => Promise.resolve({}),
    },
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
          // Each of these is a re-read in the real content script.
          setTimeout(
            () => announce(harness, frameId, { reread: true }),
            knobs.answerDelayMs,
          );
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

/** Deliver a `FRAME_TREE_DATA` to the background as frame `frameId` would,
 *  with `extra` on its payload. */
function announce(h: Harness, frameId: number, extra: object = {}) {
  for (const fn of h.messageListeners) {
    fn(
      {
        type: "FRAME_TREE_DATA",
        payload: { ...frameTreePayload(frameId), ...extra },
      },
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
   * A frame that cannot host a content script — a `data:` frame, a PDF — is
   * reported by `getAllFrames` and never answers. It must not hold the
   * panel's tree back, or an ordinary page with such a frame pays the wait
   * forever.
   */
  it("publishes without waiting on a frame that can never answer", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    h.knobs.frames = [
      ...PAGE_FRAMES,
      { frameId: 9, parentFrameId: 0, url: "data:text/html,<p>Ad</p>" },
    ];
    h.liveFrames.delete(9); // no content script, will never announce

    const before = h.tabMessages.length;
    // Every real frame announces, so the unanswerable one is the ONLY thing
    // missing — otherwise the deferral is owed to frames 1 and 2 and this
    // says nothing about frame 9.
    for (const frameId of [0, 1, 2]) announce(h, frameId);
    // ONE debounce, not `runAllTimersAsync()`. The wait is the whole subject:
    // soliciting the unanswerable frame reaches the same complete tree, just
    // a debounce later, so draining every timer hides the difference.
    await vi.advanceTimersByTimeAsync(200);

    expect(reAnnounceRequests(h, before).map((m) => m.frameId)).not.toContain(
      9,
    );
    const ids = lastTreeToPanel(h);
    expect(ids).toContain("f1-root");
    expect(ids).toContain("f2-root");
  });

  /**
   * The content script runs in an `about:blank` or `srcdoc` frame of a page
   * it runs in (`match_about_blank`), so one whose tree the worker lost is
   * asked for it like any other.
   */
  it("asks a frame with no URL of its own for the tree the worker lost", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    h.knobs.frames = [
      ...PAGE_FRAMES,
      { frameId: 8, parentFrameId: 0, url: "about:blank" },
      { frameId: 9, parentFrameId: 0, url: "about:srcdoc" },
    ];
    h.liveFrames.add(8).add(9);

    const before = h.tabMessages.length;
    for (const frameId of [0, 1, 2]) announce(h, frameId);
    await vi.runAllTimersAsync();

    expect(
      reAnnounceRequests(h, before)
        .map((m) => m.frameId)
        .sort(),
    ).toEqual([8, 9]);
    expect(lastTreeToPanel(h)).toContain("f8-root");
    expect(lastTreeToPanel(h)).toContain("f9-root");
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
   * What this pins is the name: a closed tab produces no further traffic,
   * however far along its in-flight merge was.
   *
   * It does NOT cover `scheduleMerge`'s resolve-don't-create — reverting that
   * leaves this green. The resurrected `TabState` has an empty `frames` map,
   * so the pre-`await` guard bails it out before any Chrome call: the leak is
   * a dangling entry nothing will ever delete, with no route to the module's
   * surface for a black-box test to observe. Asserting it would mean
   * exporting the registry from a service-worker entry purely for tests,
   * which costs more than the leak does.
   */
  it("sends nothing more once the tab has been closed", async () => {
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

/**
 * Delivery of a panel→content broadcast is only known once Chrome has run the
 * `tabs.sendMessage` callback. Answering the panel before then reports success
 * on pages where no content script can run at all (chrome://, the Web Store,
 * the built-in PDF viewer) — and since the panel's whole "am I attached?"
 * signal is a tree that never arrives, it sits on "Connecting to page..."
 * forever instead of saying the page is out of reach.
 */
describe("background: a frame whose place in the tree isn't known yet", () => {
  let h: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    h = makeHarness();
    (globalThis as { chrome?: unknown }).chrome = h.chromeMock;
    await import("./background.js");
    await vi.runAllTimersAsync();
    // A page with a blank frame, which says where it goes by the mark its
    // script left on its <iframe> (see frame-owner.ts).
    h.knobs.frames = [
      ...PAGE_FRAMES,
      { frameId: 9, parentFrameId: 0, url: "about:blank" },
    ];
    h.liveFrames.add(9);
    // A panel that can close again, which the shared `connectPanel` can't.
    closePanel = [];
    for (const fn of h.connectListeners) {
      fn({
        name: "sidepanel",
        onDisconnect: { addListener: (cb: () => void) => closePanel.push(cb) },
      });
    }
    await vi.runAllTimersAsync();
    h.panelMessages.length = 0;
    h.tabMessages.length = 0;
  });
  let closePanel: Array<() => void>;
  const disconnectPanel = () => closePanel.forEach((cb) => cb());

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  /** Deliver a `FRAME_TREE_DATA` with this payload, as frame `frameId`. */
  function announceTree(frameId: number, payload: object) {
    for (const fn of h.messageListeners) {
      fn(
        { type: "FRAME_TREE_DATA", payload },
        { id: EXTENSION_ID, tab: { id: TAB_ID }, frameId },
        () => {},
      );
    }
  }
  /** The top frame's tree, with a blank <iframe> bearing `mark` if any. */
  function topTree(mark?: string) {
    const top = frameTreePayload(0);
    const blank = makeNode("ifBlank", {
      parentId: "root",
      depth: 1,
      tagName: "iframe",
    });
    return {
      ...top,
      nodes: [...top.nodes, ["ifBlank", blank]],
      ...(mark !== undefined ? { embeds: [["ifBlank", mark]] } : {}),
    };
  }
  const blankTree = (owner: string) => ({
    ...frameTreePayload(9),
    frameUrl: "about:blank",
    owner,
  });
  function lastNodes(): Map<string, SemanticNode> {
    const trees = h.panelMessages.filter((m) => m.type === "TREE_DATA");
    const last = trees[trees.length - 1] as unknown as {
      payload: { nodes: Array<[string, SemanticNode]> };
    };
    return new Map(last.payload.nodes);
  }

  it("puts a blank frame's tree under the <iframe> bearing its mark", async () => {
    announceTree(0, topTree("mark-9"));
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.runAllTimersAsync();

    expect(lastNodes().get("f9-root")!.parentId).toBe("ifBlank");
    expect(lastNodes().get("ifBlank")!.childIds).toEqual(["f9-root"]);
    // Nothing to ask after.
    expect(sentSince(h, 0, "RESEND_TREE")).toEqual([]);
  });

  it("leaves a frame its tree couldn't place to the tree around it arriving on its own", async () => {
    // The top frame's tree as it was before the frame's script loaded. A
    // page that adds a frame changes, and sends a tree for it shortly.
    announceTree(0, topTree());
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(200);

    // Unplaced, guessed under no <iframe> meanwhile, and nobody asked yet:
    // asking reads the whole document around it.
    expect(lastNodes().get("f9-root")!.parentId).toBeNull();
    expect(sentSince(h, 0, "RESEND_TREE")).toEqual([]);

    announceTree(0, topTree("mark-9"));
    await vi.runAllTimersAsync();
    expect(lastNodes().get("f9-root")!.parentId).toBe("ifBlank");
    expect(sentSince(h, 0, "RESEND_TREE")).toEqual([]);
  });

  it("asks the document around it for its tree again, once, when none has come after a while", async () => {
    announceTree(0, topTree());
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(200);
    expect(sentSince(h, 0, "RESEND_TREE")).toEqual([]);
    const published = h.panelMessages.filter((m) => m.type === "TREE_DATA");

    // Nothing changed in the top document, so it sent nothing.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sentSince(h, 0, "RESEND_TREE").map((m) => m.frameId)).toEqual([0]);
    // The check itself publishes nothing: the trees are as they were.
    expect(h.panelMessages.filter((m) => m.type === "TREE_DATA")).toEqual(
      published,
    );

    // The top frame answers with a tree that doesn't bear the mark either
    // (it leaves the element out, say): it isn't asked again, on that merge
    // or any later one.
    await vi.runAllTimersAsync();
    announce(h, 1);
    await vi.runAllTimersAsync();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);
  });

  it("places the frame once the tree it asked for bears the mark", async () => {
    announceTree(0, topTree());
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(200 + 1_500);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);
    // Past this harness's own answer to the ask, which is the top frame's
    // tree as the fixture has it, with no blank <iframe> at all.
    await vi.runAllTimersAsync();
    expect(lastNodes().get("f9-root")!.parentId).toBeNull();

    announceTree(0, topTree("mark-9"));
    await vi.advanceTimersByTimeAsync(200);
    expect(lastNodes().get("f9-root")!.parentId).toBe("ifBlank");
  });

  it("asks again for a frame that comes back with another mark", async () => {
    announceTree(0, topTree());
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(200 + 1_500);
    await vi.runAllTimersAsync();
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);

    // Another document in the frame: another script, another mark, and
    // its own while to be placed in.
    announceTree(9, blankTree("mark-next"));
    await vi.advanceTimersByTimeAsync(200);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(2);
  });

  it("asks nobody about a frame whose <iframe> the tree around it has no node for", async () => {
    // A hidden <iframe>, left out of the a11y view: the top frame reports
    // its mark with no node. The frame can't be placed, and reading the top
    // document again wouldn't change that.
    announceTree(0, { ...topTree(), embeds: [["", "mark-9"]] });
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sentSince(h, 0, "RESEND_TREE")).toEqual([]);
    expect(lastNodes().get("f9-root")!.parentId).toBeNull();
    expect(lastNodes().get("ifBlank")!.childIds).toEqual([]);
  });

  it("starts over for a frame that was placed and is unplaced again", async () => {
    announceTree(0, topTree());
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(200 + 1_500);
    await vi.runAllTimersAsync();
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);

    // Placed, then the top frame's tree stops bearing the mark.
    announceTree(0, topTree("mark-9"));
    await vi.runAllTimersAsync();
    expect(lastNodes().get("f9-root")!.parentId).toBe("ifBlank");
    announceTree(0, topTree());
    await vi.advanceTimersByTimeAsync(200);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(2);
  });

  it("checks on each waiting frame when its own while is up, one check at a time", async () => {
    announceTree(0, topTree());
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(700);
    // A second frame the page adds, half a second after the first was
    // found unplaced.
    h.knobs.frames = [
      ...h.knobs.frames,
      { frameId: 10, parentFrameId: 0, url: "about:srcdoc" },
    ];
    h.liveFrames.add(10);
    announceTree(10, { ...blankTree("mark-10"), frameUrl: "about:srcdoc" });
    await vi.advanceTimersByTimeAsync(200);
    expect(sentSince(h, 0, "RESEND_TREE")).toEqual([]);

    // The first frame's while is up, the second's isn't.
    await vi.advanceTimersByTimeAsync(900);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);
    // The top frame's answer still bears neither mark; the second frame is
    // asked after in its own time.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(2);
  });

  it("still asks when the clock steps back while a frame waits", async () => {
    announceTree(0, topTree());
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(200);
    vi.setSystemTime(Date.now() - 60_000);
    // Not at the first check, which finds the frame's wait in the future,
    // but one full wait after it rather than a minute later.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sentSince(h, 0, "RESEND_TREE")).toEqual([]);
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);
  });

  it("holds a sibling's guessed place back only until the document around them has been read again", async () => {
    // Frame 11 marked nothing and its URL matches no <iframe>'s `src`, so
    // it is placed by the last-resort guess: the first empty <iframe>, which
    // may be the one frame 9 is waiting to be placed under.
    h.knobs.frames = [
      ...h.knobs.frames,
      { frameId: 11, parentFrameId: 0, url: "https://c.test/redirected" },
    ];
    h.liveFrames.add(11);
    const redirected = {
      ...frameTreePayload(1),
      frameUrl: "https://c.test/redirected",
    };
    announceTree(0, topTree());
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    announceTree(11, redirected);
    await vi.advanceTimersByTimeAsync(200);
    expect(lastNodes().get("f11-root")!.parentId).toBeNull();

    // Asked after, and the top frame's tree comes back bearing no such
    // mark: frame 9's <iframe> is one the tree has no node for, so the
    // guess can't take it, and is taken again.
    await vi.advanceTimersByTimeAsync(1_500);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);
    await vi.runAllTimersAsync();
    announceTree(0, topTree());
    await vi.runAllTimersAsync();
    expect(lastNodes().get("f11-root")!.parentId).toBe("ifBlank");
    expect(lastNodes().get("f9-root")!.parentId).toBeNull();
  });

  it("remembers a frame has no place when the panel asks for the tree again", async () => {
    h.knobs.frames = [
      ...h.knobs.frames,
      { frameId: 11, parentFrameId: 0, url: "https://c.test/redirected" },
    ];
    h.liveFrames.add(11);
    const redirected = {
      ...frameTreePayload(1),
      frameUrl: "https://c.test/redirected",
    };
    const announcePage = () => {
      announceTree(0, topTree());
      for (const frameId of [1, 2]) announce(h, frameId);
      announceTree(9, blankTree("mark-9"));
      announceTree(11, redirected);
    };
    announcePage();
    await vi.advanceTimersByTimeAsync(200 + 1_500);
    await vi.runAllTimersAsync();
    announceTree(0, topTree());
    await vi.runAllTimersAsync();
    expect(lastNodes().get("f11-root")!.parentId).toBe("ifBlank");
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);

    // The panel's REQUEST_TREE, as it sends after every action: every
    // frame's tree is dropped and sent again, the same page as before.
    for (const fn of h.messageListeners) {
      fn(
        { type: "REQUEST_TREE", tabId: TAB_ID, payload: { viewMode: "a11y" } },
        { id: EXTENSION_ID },
        () => {},
      );
    }
    await vi.advanceTimersByTimeAsync(0);
    announcePage();
    await vi.advanceTimersByTimeAsync(200);
    // At once, with no second wait and nobody asked again.
    expect(lastNodes().get("f11-root")!.parentId).toBe("ifBlank");
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);
  });

  it("remembers it through a request the frame answers before its parent does", async () => {
    // The blank frame is inside frame 1 here. After a fresh request its own
    // tree is back first: with no tree for the frame around it, the merge
    // says nothing of it either way, which isn't the frame being placed.
    h.knobs.frames = [
      ...PAGE_FRAMES,
      { frameId: 9, parentFrameId: 1, url: "about:blank" },
    ];
    announce(h, 0);
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(200 + 1_500);
    await vi.runAllTimersAsync();
    expect(sentSince(h, 0, "RESEND_TREE").map((m) => m.frameId)).toEqual([1]);

    h.liveFrames.delete(1); // slow to answer the request below
    for (const fn of h.messageListeners) {
      fn(
        { type: "REQUEST_TREE", tabId: TAB_ID, payload: { viewMode: "a11y" } },
        { id: EXTENSION_ID },
        () => {},
      );
    }
    await vi.advanceTimersByTimeAsync(0);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(200);
    announce(h, 1);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);
  });

  it("forgets it when the page navigates: the next page's frames are new", async () => {
    announceTree(0, topTree());
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(200 + 1_500);
    await vi.runAllTimersAsync();
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(1);

    beginTopFrameNavigation(h);
    announceTree(0, topTree());
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(200 + 1_500);
    expect(sentSince(h, 0, "RESEND_TREE")).toHaveLength(2);
  });

  it("asks nobody once the panel has closed", async () => {
    announceTree(0, topTree());
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, blankTree("mark-9"));
    await vi.advanceTimersByTimeAsync(200);
    disconnectPanel();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sentSince(h, 0, "RESEND_TREE")).toEqual([]);
  });

  it("keeps a mark that isn't well formed out of the merge", async () => {
    announceTree(0, { ...topTree(), embeds: [["ifBlank", 9], "junk"] });
    for (const frameId of [1, 2]) announce(h, frameId);
    announceTree(9, { ...blankTree("x"), owner: { toString: () => "9" } });
    await vi.runAllTimersAsync();

    // With no mark, the frame is placed as any other: by the last-resort
    // guess, under the one <iframe> nothing else is in.
    expect(lastNodes().get("f9-root")!.parentId).toBe("ifBlank");
    expect(sentSince(h, 0, "RESEND_TREE")).toEqual([]);
  });
});

describe("background: panel broadcast delivery reporting", () => {
  let h: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    h = makeHarness();
    (globalThis as { chrome?: unknown }).chrome = h.chromeMock;
    await import("./background.js");
    await vi.runAllTimersAsync();
    h.panelMessages.length = 0;
    h.tabMessages.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  /** Send a panel→background message and collect every reply it produces. */
  function sendFromPanel(message: {
    type: string;
    payload?: unknown;
    tabId?: number;
  }): unknown[] {
    const replies: unknown[] = [];
    for (const fn of h.messageListeners) {
      fn({ tabId: TAB_ID, ...message }, { id: EXTENSION_ID }, (response) =>
        replies.push(response),
      );
    }
    return replies;
  }

  it("reports failure when no frame in the tab could receive REQUEST_TREE", async () => {
    h.knobs.sendError = { message: "Could not establish connection." };

    const replies = sendFromPanel({
      type: "REQUEST_TREE",
      payload: { viewMode: "a11y" },
    });
    // Nothing may be claimed before Chrome has run the send callback.
    expect(replies).toEqual([]);

    await vi.runAllTimersAsync();
    expect(replies).toEqual([{ success: false, error: "restricted-page" }]);
  });

  it("does not report a restricted page when the tab simply went away", async () => {
    // A re-extract queued before the user closed the tab lands after it is
    // gone. Reporting that as `restricted-page` would put the panel's
    // "Chrome doesn't allow extensions here" message on an ordinary page.
    h.knobs.sendError = { message: "No tab with id: 42." };

    const replies = sendFromPanel({
      type: "REQUEST_TREE",
      payload: { viewMode: "a11y" },
    });
    await vi.runAllTimersAsync();

    expect(replies).toEqual([{ success: false, error: "No tab with id: 42." }]);
  });

  /**
   * The panel's only "am I attached?" signal is a tree arriving, so a request
   * that is delivered but never answered is indistinguishable from a page
   * still loading — and it never resolves. `sidepanelConnected` tracks a
   * connected PORT, which a service worker revived BY THIS VERY MESSAGE does
   * not yet have, so the merge used to drop the answer on the floor. Nothing
   * retried: a content script re-announces only when its own DOM next
   * mutates, so on a static page the panel waited on "Connecting to page…"
   * forever.
   */
  it("publishes the tree for a panel request even with no port connected yet", async () => {
    // No connectPanel() — this is a worker woken by the request itself.
    const replies = sendFromPanel({
      type: "REQUEST_TREE",
      payload: { viewMode: "a11y" },
    });
    await vi.runAllTimersAsync();

    expect(replies).toEqual([{ success: true }]);
    expect(lastTreeToPanel(h)).not.toBeNull();
  });

  it("still publishes nothing for an unsolicited announce with no panel", async () => {
    // The guard's original job: a frame announcing with no panel attached
    // buys nobody anything. Only a request the panel made relaxes it.
    announce(h, 0);
    await vi.runAllTimersAsync();

    expect(lastTreeToPanel(h)).toBeNull();
  });

  it("reports success once a reachable tab has taken REQUEST_TREE", async () => {
    const replies = sendFromPanel({
      type: "REQUEST_TREE",
      payload: { viewMode: "a11y" },
    });
    await vi.runAllTimersAsync();

    expect(replies).toEqual([{ success: true }]);
  });
});

/**
 * A tree only ever reaches the panel because some frame announced. Navigating
 * to a page that can run no content script produces no announcement at all —
 * so without an explicit signal the panel kept rendering the PREVIOUS page's
 * tree indefinitely. Worse than empty: node ids are a per-frame counter, so
 * those rows resolve to unrelated elements on the new page while staying
 * clickable.
 */
describe("background: top-frame navigation tells the panel its tree is stale", () => {
  let h: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    h = makeHarness();
    (globalThis as { chrome?: unknown }).chrome = h.chromeMock;
    await import("./background.js");
    await vi.runAllTimersAsync();
    h.panelMessages.length = 0;
    h.tabMessages.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  it("pushes PAGE_NAVIGATED when the top frame navigates", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();
    announce(h, 0);
    await vi.runAllTimersAsync();
    h.panelMessages.length = 0;

    beginTopFrameNavigation(h);
    await vi.runAllTimersAsync();

    expect(h.panelMessages.filter((m) => m.type === "PAGE_NAVIGATED")).toEqual([
      { type: "PAGE_NAVIGATED", tabId: TAB_ID },
    ]);
  });

  it("does not push it for a subframe navigation", async () => {
    // A subframe leaving invalidates its own subtree, not the whole page —
    // the existing remerge covers that, and blanking the panel would be a
    // gratuitous loss of the user's expand state and selection.
    connectPanel(h);
    await vi.runAllTimersAsync();
    announce(h, 0);
    await vi.runAllTimersAsync();
    h.panelMessages.length = 0;

    for (const fn of h.navigateListeners) fn({ tabId: TAB_ID, frameId: 1 });
    await vi.runAllTimersAsync();

    expect(h.panelMessages.filter((m) => m.type === "PAGE_NAVIGATED")).toEqual(
      [],
    );
  });
});

describe("background: page focus forwarded to the panel", () => {
  let h: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    h = makeHarness();
    (globalThis as { chrome?: unknown }).chrome = h.chromeMock;
    await import("./background.js");
    await vi.runAllTimersAsync();
    h.panelMessages.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  /** Report focus as frame `frameId`'s content script does. */
  function reportFocus(frameId: number, payload: object) {
    for (const fn of h.messageListeners) {
      fn(
        { type: "FOCUS_CHANGED", payload },
        { id: EXTENSION_ID, tab: { id: TAB_ID }, frameId },
        () => {},
      );
    }
  }

  const forwarded = () =>
    h.panelMessages.filter((m) => m.type === "FOCUS_CHANGED");

  it("passes the top frame's page keys on with its node, as frame 0's", () => {
    const pageKeys = { "read-1": [7, 2, 0] };
    reportFocus(0, { nodeId: "n3", pageKeys });
    reportFocus(0, { pageKeys });
    expect(forwarded()).toEqual([
      {
        type: "FOCUS_CHANGED",
        tabId: TAB_ID,
        payload: { nodeId: "n3", pageKeys, frameId: 0 },
      },
      {
        type: "FOCUS_CHANGED",
        tabId: TAB_ID,
        payload: { pageKeys, frameId: 0 },
      },
    ]);
  });

  it("passes a subframe's page keys on with the frame they number, its node frame-prefixed", () => {
    const pageKeys = { "read-1": [7] };
    reportFocus(2, { nodeId: "n3", pageKeys });
    reportFocus(2, { nodeId: "n4" });
    expect(forwarded()).toEqual([
      {
        type: "FOCUS_CHANGED",
        tabId: TAB_ID,
        payload: { nodeId: "f2-n3", pageKeys, frameId: 2 },
      },
      { type: "FOCUS_CHANGED", tabId: TAB_ID, payload: { nodeId: "f2-n4" } },
    ]);
  });

  it("names the frame from the sender, never from what the page sent", () => {
    const pageKeys = { "read-1": [7] };
    reportFocus(2, { pageKeys, frameId: 0 });
    expect(forwarded()).toEqual([
      {
        type: "FOCUS_CHANGED",
        tabId: TAB_ID,
        payload: { pageKeys, frameId: 2 },
      },
    ]);
  });
});

describe("background: the Focus sync toggle, through page updates", () => {
  let h: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    h = makeHarness();
    (globalThis as { chrome?: unknown }).chrome = h.chromeMock;
    await import("./background.js");
    await vi.runAllTimersAsync();
    connectPanel(h);
    await vi.runAllTimersAsync();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  /** The panel sets Focus sync for the tab it is bound to. */
  function setFocusSync(enabled: boolean) {
    for (const fn of h.messageListeners) {
      fn(
        { type: "SET_FOCUS_TRACKER", tabId: TAB_ID, payload: { enabled } },
        { id: EXTENSION_ID },
        () => {},
      );
    }
  }

  /** What the frames were last told about the tracker, frame by frame. */
  function trackerSentSince(from: number): Array<boolean | undefined> {
    return sentSince(h, from, "SET_FOCUS_TRACKER").map(
      (m) => (m.body.payload as { enabled?: boolean }).enabled,
    );
  }

  it("keeps a tracker the panel turned off off when the page updates its tree", async () => {
    setFocusSync(false);
    await vi.runAllTimersAsync();
    const from = h.tabMessages.length;
    announce(h, 0);
    for (const fn of h.messageListeners) {
      fn(
        { type: "FRAME_HELLO" },
        { id: EXTENSION_ID, tab: { id: TAB_ID }, frameId: 1 },
        () => {},
      );
    }
    await vi.runAllTimersAsync();
    // Every frame that announced (the merge asks the others to, too).
    const sent = trackerSentSince(from);
    expect(sent.length).toBeGreaterThanOrEqual(2);
    expect(new Set(sent)).toEqual(new Set([false]));
  });

  it("turns it back on once the panel does", async () => {
    setFocusSync(false);
    setFocusSync(true);
    await vi.runAllTimersAsync();
    const from = h.tabMessages.length;
    announce(h, 0);
    await vi.runAllTimersAsync();
    const sent = trackerSentSince(from);
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(new Set(sent)).toEqual(new Set([true]));
  });
});

describe("background: which frames' changes Chrome's tree follows", () => {
  let h: Harness;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.resetModules();
    h = makeHarness();
    (globalThis as { chrome?: unknown }).chrome = h.chromeMock;
    await import("./background.js");
    await vi.runAllTimersAsync();
    connectPanel(h);
    // The page, its two frames placed under their <iframe>s.
    for (const frameId of [0, 1, 2]) announce(h, frameId);
    await vi.runAllTimersAsync();
    h.panelMessages.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as { chrome?: unknown }).chrome;
  });

  /** Deliver a `FRAME_TREE_DATA` with this payload, as frame `frameId`. */
  function deliver(frameId: number, payload: object) {
    for (const fn of h.messageListeners) {
      fn(
        { type: "FRAME_TREE_DATA", payload },
        { id: EXTENSION_ID, tab: { id: TAB_ID }, frameId },
        () => {},
      );
    }
  }

  /** Each published tree's `pageChangedAt`, since the last call. */
  function changedAt(): unknown[] {
    const out = h.panelMessages
      .filter((m) => m.type === "TREE_DATA")
      .map((m) => (m.payload as { pageChangedAt?: unknown }).pageChangedAt);
    h.panelMessages.length = 0;
    return out;
  }

  /** Whether each published tree says the page changed, since the last
   *  call. */
  function pageChanged(): boolean[] {
    return changedAt().map((at) => Array.isArray(at));
  }

  it("follows a change in a frame the page shows, as one in the top frame", async () => {
    announce(h, 1);
    await vi.runAllTimersAsync();
    expect(pageChanged()).toEqual([true]);
    announce(h, 0);
    await vi.runAllTimersAsync();
    expect(pageChanged()).toEqual([true]);
  });

  it("leaves out a change in a frame hidden from assistive technology", async () => {
    // The top frame's second <iframe>, frame 2's, is hidden: Chrome's tree
    // has no row for it to read the frame under.
    const top = frameTreePayload(0);
    deliver(0, {
      ...top,
      nodes: top.nodes.map(([id, node]) =>
        id === "ifB"
          ? [id, { ...node, a11y: { ...node.a11y, isExposedToAT: false } }]
          : [id, node],
      ),
    });
    await vi.runAllTimersAsync();
    pageChanged();

    announce(h, 2);
    await vi.runAllTimersAsync();
    expect(pageChanged()).toEqual([false]);
    announce(h, 1);
    await vi.runAllTimersAsync();
    expect(pageChanged()).toEqual([true]);
  });

  it("leaves out a change in a frame the tree has no place for", async () => {
    const url = "https://c.test/widget";
    h.knobs.frames.push({ frameId: 3, parentFrameId: 0, url });
    deliver(3, {
      frameUrl: url,
      pageTitle: "Frame 3",
      rootId: "root",
      nodes: [["root", makeNode("root")]],
    });
    await vi.runAllTimersAsync();
    expect(pageChanged()).toEqual([false]);
  });

  it("leaves out a frame read again rather than changed", async () => {
    // An answer to RESEND_TREE or REQUEST_TREE, or the re-read after a key.
    deliver(1, { ...frameTreePayload(1), reread: true });
    await vi.runAllTimersAsync();
    expect(pageChanged()).toEqual([false]);
    deliver(0, { ...frameTreePayload(0), reread: true });
    await vi.runAllTimersAsync();
    expect(pageChanged()).toEqual([false]);
  });

  it("says when each frame the page shows changed, as the frame saw it", async () => {
    deliver(1, { ...frameTreePayload(1), changedAt: 1_000 });
    await vi.runAllTimersAsync();
    expect(changedAt()).toEqual([[1_000]]);
    // Each one, earliest first: an action's window may hold either.
    deliver(1, { ...frameTreePayload(1), changedAt: 3_000 });
    deliver(0, { ...frameTreePayload(0), changedAt: 2_000 });
    await vi.runAllTimersAsync();
    expect(changedAt()).toEqual([[2_000, 3_000]]);
  });

  it("keeps a change made while a publish waits for the frame list for the next one", async () => {
    h.knobs.getAllFramesDelayMs = 100;
    deliver(1, { ...frameTreePayload(1), changedAt: 1_000 });
    // The publish has asked for the frame list when frame 1 changes again.
    await vi.advanceTimersByTimeAsync(250);
    deliver(1, { ...frameTreePayload(1), changedAt: 2_000 });
    await vi.runAllTimersAsync();
    expect(changedAt()).toEqual([[1_000], [2_000]]);
  });

  it("answers for a frame inside one with no place yet once that one has it", async () => {
    // Frame 5's <iframe> isn't in the page's tree as it was read; frame 7
    // sits inside frame 5.
    h.knobs.frames.push(
      { frameId: 5, parentFrameId: 0, url: "https://c.test/" },
      { frameId: 7, parentFrameId: 5, url: "https://d.test/" },
    );
    deliver(5, {
      frameUrl: "https://c.test/",
      pageTitle: "Frame 5",
      rootId: "root",
      changedAt: 1_000,
      nodes: [
        ["root", makeNode("root", { childIds: ["ifD"] })],
        [
          "ifD",
          makeNode("ifD", {
            parentId: "root",
            depth: 1,
            tagName: "iframe",
            attrs: { src: "https://d.test/" },
          }),
        ],
      ],
    });
    deliver(7, {
      frameUrl: "https://d.test/",
      pageTitle: "Frame 7",
      rootId: "root",
      changedAt: 2_000,
      nodes: [["root", makeNode("root")]],
    });
    await vi.runAllTimersAsync();
    expect(changedAt().every((at) => at === undefined)).toBe(true);

    // The page's tree, read again, has frame 5's <iframe> now.
    const top = frameTreePayload(0);
    deliver(0, {
      ...top,
      reread: true,
      nodes: [
        ["root", makeNode("root", { childIds: ["ifA", "ifB", "ifC"] })],
        ...top.nodes.slice(1),
        [
          "ifC",
          makeNode("ifC", {
            parentId: "root",
            depth: 1,
            tagName: "iframe",
            attrs: { src: "https://c.test/" },
          }),
        ],
      ],
    });
    await vi.runAllTimersAsync();
    expect(changedAt()).toEqual([[1_000, 2_000]]);
  });

  it("answers once for a marked frame its URL placed", async () => {
    // Frame 2 marked its <iframe> after the page's tree was read, but its URL
    // places it all the same.
    deliver(2, { ...frameTreePayload(2), owner: "mark-2", changedAt: 4_000 });
    await vi.runAllTimersAsync();
    expect(changedAt()).toContainEqual([4_000]);
    deliver(1, { ...frameTreePayload(1), reread: true });
    await vi.runAllTimersAsync();
    expect(changedAt().every((at) => at === undefined)).toBe(true);
  });

  it("never dates a change after now", async () => {
    const now = Date.now();
    deliver(1, { ...frameTreePayload(1), changedAt: now + 60_000 });
    await vi.runAllTimersAsync();
    const [[at]] = changedAt() as number[][];
    expect(at).toBeGreaterThanOrEqual(now);
    expect(at).toBeLessThanOrEqual(Date.now());
  });

  it("answers for a frame waiting for its place in the publish that places it", async () => {
    // A blank frame of the page's own origin goes under the <iframe> its
    // script marks, and the page's tree was read before it marked it.
    h.knobs.frames.push({ frameId: 9, parentFrameId: 0, url: "about:blank" });
    // The page's answer to being asked where the frame goes is sent below.
    h.liveFrames.delete(0);
    const top = (mark?: string) => {
      const payload = frameTreePayload(0);
      return {
        ...payload,
        nodes: [
          ...payload.nodes,
          [
            "ifBlank",
            makeNode("ifBlank", {
              parentId: "root",
              depth: 1,
              tagName: "iframe",
            }),
          ],
        ],
        ...(mark !== undefined ? { embeds: [["ifBlank", mark]] } : {}),
      };
    };
    const blank = {
      ...frameTreePayload(9),
      frameUrl: "about:blank",
      owner: "mark-9",
    };
    deliver(0, top());
    await vi.runAllTimersAsync();
    changedAt();
    deliver(9, { ...blank, changedAt: 5_000 });
    await vi.runAllTimersAsync();
    const unplaced = changedAt();
    expect(unplaced.length).toBeGreaterThan(0);
    expect(unplaced.every((at) => at === undefined)).toBe(true);

    // The page's tree, sent again when the service worker asks where the
    // frame goes, places it: its change is the page's now.
    deliver(0, { ...top("mark-9"), reread: true });
    await vi.runAllTimersAsync();
    expect(changedAt()).toEqual([[5_000]]);
  });

  it("answers for a frame whose first tree arrives while a publish waits for the frame list", async () => {
    // Frame 1 holds an <iframe> for frame 3, which is still loading.
    const url = "https://c.test/widget";
    deliver(1, {
      ...frameTreePayload(1),
      nodes: [
        ["root", makeNode("root", { childIds: ["ifC"] })],
        [
          "ifC",
          makeNode("ifC", {
            parentId: "root",
            depth: 1,
            tagName: "iframe",
            attrs: { src: url },
          }),
        ],
      ],
    });
    await vi.runAllTimersAsync();
    pageChanged();

    h.knobs.getAllFramesDelayMs = 100;
    announce(h, 0);
    // The publish has asked for the frame list, which doesn't have frame 3
    // yet, when frame 3's first tree arrives.
    await vi.advanceTimersByTimeAsync(250);
    deliver(3, {
      frameUrl: url,
      pageTitle: "Frame 3",
      rootId: "root",
      nodes: [["root", makeNode("root")]],
    });
    await vi.advanceTimersByTimeAsync(60);
    expect(pageChanged()).toEqual([true]);

    // Placed by the next publish, which answers for it.
    h.knobs.frames.push({ frameId: 3, parentFrameId: 1, url });
    await vi.runAllTimersAsync();
    expect(pageChanged()).toEqual([true]);
  });
});
