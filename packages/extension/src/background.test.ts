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

function makeHarness() {
  const tabMessages: SentTabMessage[] = [];
  const panelMessages: Array<{ type: string; [k: string]: unknown }> = [];
  const messageListeners: MessageListener[] = [];
  const connectListeners: ConnectListener[] = [];
  const navigateListeners: NavigateListener[] = [];
  /** Frames whose content script is loaded and will answer. */
  const liveFrames = new Set(PAGE_FRAMES.map((f) => f.frameId));

  const noopEvent = () => ({ addListener: () => {} });

  const chromeMock = {
    runtime: {
      id: EXTENSION_ID,
      lastError: undefined,
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
      getAllFrames: () => Promise.resolve(PAGE_FRAMES),
    },
    tabs: {
      onActivated: noopEvent(),
      onRemoved: noopEvent(),
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
        cb?.();

        // The addressed content script(s) act on it. Anything that makes a
        // real one call `sendTree()` announces back, a turn later — the same
        // ordering the real message round trip has.
        if (!RE_ANNOUNCE_TRIGGERS.has(body.type)) return;
        // `chrome.tabs.sendMessage` reaches every frame in the tab unless
        // `options.frameId` names one.
        const targets =
          opts?.frameId === undefined
            ? PAGE_FRAMES.map((f) => f.frameId)
            : [opts.frameId];
        for (const frameId of targets) {
          if (!liveFrames.has(frameId)) continue;
          queueMicrotask(() => announce(harness, frameId));
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
    liveFrames,
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
   * The panel rebuilds its node map from each TREE_DATA, so publishing the
   * half-known tree would cost the user their expanded rows, selection and
   * scope and then restore the subtrees collapsed — the iframe content still
   * vanishing, just briefly. Nothing should go out until it is whole.
   */
  it("publishes no half-known tree while the missing frames are being fetched", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

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
   * An aborted top-frame navigation — a download link, a 204 — fires
   * `onBeforeNavigate` and then nothing loads. The frame map is emptied while
   * the page's content scripts stay alive, observing and silent, which is the
   * same stranding the restart causes.
   */
  it("recovers again after a navigation that empties the frame map", async () => {
    connectPanel(h);
    await vi.runAllTimersAsync();

    announce(h, 0);
    await vi.runAllTimersAsync();

    beginTopFrameNavigation(h);

    // The navigation is abandoned; the still-loaded top frame mutates later.
    announce(h, 0);
    await vi.runAllTimersAsync();

    const ids = lastTreeToPanel(h);
    expect(ids).toContain("f1-root");
    expect(ids).toContain("f2-root");
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
