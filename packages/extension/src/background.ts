/// <reference types="chrome" />

import * as curtains from "./curtain-store.js";
import {
  asFrameMarks,
  buildFrameInfoMap,
  mergeFrameTrees,
  unplacedFrames,
} from "./frame-merger.js";
import { registerNativeMode, releaseDebugger } from "./native/index.js";
import {
  type PlannedTabMessage,
  describeBroadcastDelivery,
  isTrustedSender,
  lookupOrder,
  panelWindowFor,
  parseNodeId,
  planFrameAnnouncementResponse,
  planFrameHello,
  planPanelDisconnectCleanupAllTabs,
  resolvePanelTargetTab,
} from "./routing.js";
import {
  type TabState,
  answeredPlacesAskedOf,
  clearTabFrames,
  disposeTabState,
  forgetAskedPlaces,
  framesToMerge,
  getOrCreateTabState,
  publishedTree,
  recordFrameTree,
  removeFrame,
  unplaceableFrames,
} from "./tab-state.js";
import type { ContentToPanel, TreeRequest } from "./types.js";

// `chrome.debugger` native mode (RFC PR H) ships in every build now that the
// manifest carries `debugger`/`tabs`/`storage` as required permissions (see
// `public/manifest.json`) — the capability itself is always registered.
// Chrome's tree is the side panel's only tree, so no setting gates it:
// `registerNativeMode()` wires the message handlers, which answer the
// extension's own pages alone (`isExtensionPageSender`). `__DOGFOOD__` (still a
// build-time constant, see `vite.config.ts`) now only decides whether the
// dev-only `DogfoodPanel` debug widget renders (`sidepanel/main.tsx`); it no
// longer gates this module at all.
registerNativeMode();

// ---- Per-tab frame state ----
// Pure state-machine helpers live in ./tab-state, the merge algorithm in
// ./frame-merger, and the Chrome side-effects below.

const tabStates = new Map<number, TabState>();
let activeTabId: number | null = null;

// Curtain state lives in ./curtain-store, mirrored into chrome.storage.session
// so it survives the MV3 idle teardown — the curtain is painted in the page and
// outlives this worker, so a revived worker must still know to lift it. Start
// rehydrating as soon as the worker boots; the disconnect teardown awaits it.
void curtains.hydrateCurtainState();

/**
 * Tabs whose panel has asked for a tree and not yet been given one.
 *
 * `sidepanelConnected` tracks a connected PORT, and a revived service worker
 * has none until the panel's `onDisconnect` reconnect lands — but the panel is
 * plainly there, because it is what just woke us. Without this the merge below
 * refuses to publish that tree, and since a content script re-announces only
 * when its own DOM next mutates, a static page never produces another: the
 * panel waits on "Connecting to page…" forever. A request the panel itself
 * sent is proof enough of a panel to answer it.
 *
 * Scoped to the answer for that request — cleared as soon as one is published
 * — so it relaxes the guard for exactly one tree and never re-arms anything.
 */
const panelTreeRequests = new Set<number>();

function getTabState(tabId: number): TabState {
  return getOrCreateTabState(tabStates, tabId);
}

// ---- Frame tree merging ----

async function mergeAndSendTree(tabId: number) {
  // No panel means nobody consumes the merged tree — skip the getAllFrames
  // call, the merge, the node clone, and the (dropped) sendMessage. Content
  // scripts only send FRAME_TREE_DATA while observing (panel-gated), so this
  // mainly guards stale in-flight data arriving just as the panel closes.
  if (!sidepanelConnected && !panelTreeRequests.has(tabId)) return;
  const state = getTabState(tabId);
  // An emptied `frames` map must stay side-effect-free. `clearTabFrames` runs
  // on every top-frame navigation, and until the new document commits
  // `getAllFrames` still describes the outgoing one — whose subframes are
  // typically alive and mutating.
  //
  // What it costs: after a restart where a SUBFRAME announces first, nothing
  // is repaired until the top frame announces too. An empty map plus one
  // subframe tree is indistinguishable from a navigation in progress, and
  // guessing wrong there republishes the page the user just left. The outcome
  // is still correct once the top frame speaks.
  //
  // Purely an optimisation, not the correctness boundary — the post-`await`
  // re-read below is that, since this check cannot see a navigation that
  // lands while `getAllFrames` is in flight. This one just saves the IPC.
  if (!state.frames.has(0)) return;
  // The changes this publish answers for: those announced before the frame
  // list below was asked for. A frame whose first tree arrives during the
  // wait may be missing from that list, and so can't be placed, and one that
  // changes again then has a later change to report: the publish their own
  // announcements schedule answers for those.
  const changed = new Map(state.changedFrames);

  let allFrames: chrome.webNavigation.GetAllFrameResultDetails[] = [];
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (frames) allFrames = frames;
  } catch {
    // Tab might be closed or invalid
  }

  // Everything above was decided before the await; both facts can have
  // changed under it. The panel can close (leaving nobody to read a tree, and
  // nobody to want frames armed), and `onBeforeNavigate` can empty the map —
  // which is the window the pre-await check cannot cover, and the one where
  // soliciting would republish the page the user just left. Re-read rather
  // than reuse: the page identity below has to come from the same snapshot as
  // the nodes it labels.
  if (!sidepanelConnected && !panelTreeRequests.has(tabId)) return;
  const topFrame = state.frames.get(0);
  if (!topFrame) return;

  const pinged = recoverMissingFrames(tabId, state, allFrames);
  if (pinged > 0) {
    // Hold this publish back one debounce. The panel rebuilds its node map
    // from each TREE_DATA, so shipping the half-known tree costs the user
    // their expanded rows, selection and scope, then restores the subtrees
    // collapsed. Best-effort, not a guarantee: a frame slower than the
    // debounce still gets published without, and completes the tree when its
    // answer lands. Closing that gap properly needs a per-frame pending set
    // with its own deadline rather than a re-armed 200 ms timer.
    scheduleMerge(tabId);
    return;
  }

  const frameInfoMap = buildFrameInfoMap(allFrames);
  const result = mergeFrameTrees({
    frames: framesToMerge(state, frameInfoMap),
    frameInfoMap,
    unplaceable: unplaceableFrames(state),
  });
  if (!result) return; // top frame went away between schedule and run

  state.nodeToFrame = result.nodeToFrame;
  askForFramePlaces(tabId, state, result.unplaced, frameInfoMap);

  // The outstanding request is answered by this publish, whatever prompted the
  // merge — so the guard above goes back to being purely port-driven.
  panelTreeRequests.delete(tabId);
  // Send merged tree to side panel with page info. `tabId` lets the side
  // panel filter out broadcasts for tabs it isn't bound to — without that
  // any background tab's tree update leaks into every open panel.
  const tree = publishedTree(state, result, {
    tabId,
    topFrame,
    changed,
    listed: frameInfoMap,
  });
  chrome.runtime.sendMessage(tree).catch(() => {
    // Side panel might not be open
  });
}

/**
 * Ask frames the page has but we hold no tree for to re-announce themselves.
 * Returns how many were asked.
 *
 * This exists because an empty (or partial) `frames` map does not always mean
 * the missing frames are about to speak up. `tabStates` lives only in the
 * worker's memory, so a restart under an already-loaded page loses every
 * tree — while the content scripts survive, keep observing, and re-announce
 * only when their own DOM next mutates. The first frame to mutate would then
 * be merged on its own, replacing the panel's complete tree with one missing
 * every iframe subtree until each other frame happened to change. The
 * panel-connect `SET_OBSERVING` re-arm doesn't shake them loose either:
 * `startObserving()` early-returns when the frame is already observing.
 *
 * Running at merge time rather than on the announce is what keeps this from
 * being busywork. On an ordinary panel open, or a navigation, every frame
 * announces within milliseconds of being armed or loaded, so by the time the
 * merge debounce fires there is nothing missing and nothing is asked for. It
 * is also why the flag is spent only once the panel is connected and the
 * frame list actually arrived: neither of those is a chance to repair
 * anything.
 */
function recoverMissingFrames(
  tabId: number,
  state: TabState,
  allFrames: ReadonlyArray<{ frameId: number; url?: string }>,
): number {
  if (state.recoveryChecked || allFrames.length === 0) return 0;
  state.recoveryChecked = true;

  let pinged = 0;
  for (const { frameId, url } of allFrames) {
    if (state.frames.has(frameId)) continue;
    if (state.droppedFrames.has(frameId)) continue;
    if (!canHostContentScript(url)) continue;
    pinged++;
    chrome.tabs.sendMessage(tabId, { type: "RESEND_TREE" }, { frameId }, () => {
      if (chrome.runtime.lastError) {
        /* frame went away between the frame list and the send */
      }
    });
  }
  return pinged;
}

/**
 * How long a frame the merge couldn't place is left to the tree of the
 * document around it arriving on its own, before that document is asked for
 * it. Past the longest a content script holds back a tree while its page
 * keeps changing (core's `DOM_OBSERVER_MAX_WAIT_MS`), and the merge after.
 */
const PLACE_WAIT_MS = 1500;

/**
 * See to the place of each frame the merge couldn't put under its element:
 * one that marked the element holding it (`frame-owner.ts`) where no tree
 * has a node bearing the mark. That is a frame whose script loaded after the
 * document around it was last read.
 *
 * Most often that document is about to send its tree anyway: a page that
 * adds a frame changes, and the tree it sends for that carries the mark. So
 * a frame gets `PLACE_WAIT_MS` first. One still unplaced by then sits in a
 * document nothing has changed in since (a frame slow to load in a page
 * otherwise still: marking an element changes nothing in the document), and
 * its parent is asked to send its tree again. That reads the parent's whole
 * document, which is why it isn't asked at once.
 *
 * Once per frame and mark, for as long as the frame stays unplaced: asking
 * again on every merge would read the parent's document over and over for
 * nothing. A frame still unplaced once its parent has answered is held by
 * an element the tree has no node for (a hidden `<iframe>` inside a shadow
 * root, which the parent's own look for marks doesn't reach), and the merge
 * stops holding other frames' guessed places back for it
 * (`unplaceableFrames`). A frame Chrome doesn't list (a `javascript:` one) has no known
 * parent to ask. A frame whose element the parent's tree has no node for (a
 * hidden `<iframe>`, in the a11y view) is never asked after: the parent
 * reports the mark all the same, so the merge knows where it is.
 */
function askForFramePlaces(
  tabId: number,
  state: TabState,
  unplaced: readonly number[],
  frameInfoMap: ReadonlyMap<number, { parentFrameId: number }>,
): void {
  const now = Date.now();
  const parents = new Set<number>();
  // How long until the next frame still waiting is due, if any is.
  let wait: number | undefined;
  // A frame placed since starts over if it is ever unplaced again. One
  // with no tree at the moment hasn't been placed, nor one whose parent has
  // none: a fresh request dropped them, the merge says nothing of the frame
  // until both are back, and what is known of it holds when they are.
  const still = new Set(unplaced);
  for (const [frameId, place] of state.askedPlaces) {
    if (
      !still.has(frameId) &&
      state.frames.has(frameId) &&
      state.frames.has(place.parent)
    ) {
      state.askedPlaces.delete(frameId);
    }
  }
  for (const frameId of unplaced) {
    const mark = state.frames.get(frameId)?.owner;
    const parent = frameInfoMap.get(frameId)?.parentFrameId;
    if (mark === undefined || parent === undefined) continue;
    let seen = state.askedPlaces.get(frameId);
    if (seen?.mark !== mark) {
      seen = { mark, since: now, asked: false, parent, answered: false };
      state.askedPlaces.set(frameId, seen);
    }
    if (seen.asked) continue;
    // The clock went back: one full wait from here, and no longer.
    if (now < seen.since) seen.since = now;
    const left = seen.since + PLACE_WAIT_MS - now;
    if (left <= 0) {
      seen.asked = true;
      seen.parent = parent;
      parents.add(parent);
    } else {
      wait = Math.min(wait ?? left, left);
    }
  }
  for (const frameId of parents) {
    chrome.tabs.sendMessage(tabId, { type: "RESEND_TREE" }, { frameId }, () => {
      if (chrome.runtime.lastError) {
        /* the parent went away between the merge and the send */
      }
    });
  }
  // One check per tab, when the next frame is due: a page adding frames in
  // a stream doesn't stack them, and each check sets the one after it.
  if (wait !== undefined && state.placeTimer === null) {
    state.placeTimer = setTimeout(() => {
      state.placeTimer = null;
      void recheckFramePlaces(tabId);
    }, wait);
  }
}

/** `PLACE_WAIT_MS` after a merge left frames unplaced: ask after the ones
 *  that still are. Publishes nothing: the trees are as the last merge had
 *  them. */
async function recheckFramePlaces(tabId: number): Promise<void> {
  // Resolve, don't create: the tab may have closed meanwhile.
  const state = tabStates.get(tabId);
  if (!state || !sidepanelConnected) return;
  if (unplacedFrames(state.frames).length === 0) return;
  const frames = await chrome.webNavigation
    .getAllFrames({ tabId })
    .catch(() => null);
  if (!frames || tabStates.get(tabId) !== state) return;
  // Read again: a tree may have arrived while the frames were listed.
  askForFramePlaces(
    tabId,
    state,
    unplacedFrames(state.frames),
    buildFrameInfoMap(frames),
  );
}

/**
 * Whether a frame Chrome reported could be running one of our content
 * scripts, judged by its URL scheme.
 *
 * `public/manifest.json` injects at `<all_urls>`, and with its
 * `match_about_blank` into the `about:blank` and `srcdoc` frames of a page
 * it runs in. That still leaves frames guaranteed-reported and
 * guaranteed-silent: `data:` frames, PDF and plugin frames,
 * `chrome-error://`. Pinging them is harmless in itself, but each one counts
 * as missing forever and would hold the publish back a debounce every time.
 * An `about:` frame can be silent too (a sandboxed one, whose origin is its
 * own), which its URL doesn't show: it costs the one ping.
 *
 * Unknown/absent URLs are treated as reachable — better one wasted ping than
 * a silently skipped frame that needed the repair.
 */
function canHostContentScript(url: string | undefined): boolean {
  if (!url) return true;
  return (
    url.startsWith("http:") ||
    url.startsWith("https:") ||
    url.startsWith("file:") ||
    url.startsWith("ftp:") ||
    url.startsWith("about:blank") ||
    url.startsWith("about:srcdoc")
  );
}

function scheduleMerge(tabId: number) {
  // Resolve, don't create. `mergeAndSendTree` can now re-enter this after its
  // `await`, and `getOrCreateTabState` inserts on miss — so a merge in flight
  // when the tab closes would resurrect the entry `chrome.tabs.onRemoved`
  // just disposed, with nothing left to ever delete it again.
  const state = tabStates.get(tabId);
  if (!state) return;
  if (state.mergeTimer) clearTimeout(state.mergeTimer);
  state.mergeTimer = setTimeout(() => {
    state.mergeTimer = null;
    void mergeAndSendTree(tabId);
  }, 200);
}

// ---- Side panel lifecycle ----

/**
 * Send a message to every frame of the given tab, one send per frame.
 *
 * NOTE: the rationale this used to carry — that `chrome.tabs.sendMessage`
 * without an explicit `frameId` reaches only the top frame — is not what
 * Chrome does. `frameId` selects one frame *instead of all frames in the
 * tab*, so a frameId-less send already fans out and this enumeration is
 * redundant with it. Left in place here rather than removed as a drive-by:
 * the frameId-less sends elsewhere in this file were written under the same
 * wrong assumption, so which of the two forms each call site wants is worth
 * settling deliberately, not inside an unrelated fix.
 */
async function broadcastToAllFrames(tabId: number, message: unknown) {
  const frames = await chrome.webNavigation
    .getAllFrames({ tabId })
    .catch(() => null);
  if (!frames) return; /* tab closed or query failed */
  for (const { frameId } of frames) {
    chrome.tabs.sendMessage(tabId, message, { frameId }, () => {
      if (chrome.runtime.lastError) {
        /* frame may have no content script */
      }
    });
  }
}

/**
 * Send several messages to every frame of a tab, enumerating the frame list
 * ONCE. Cheaper than calling {@link broadcastToAllFrames} per message when a
 * whole batch targets the same tab (e.g. the panel-disconnect cleanup, which
 * sweeps every tab with 3-4 messages each).
 */
async function broadcastMessagesToAllFrames(
  tabId: number,
  messages: readonly unknown[],
) {
  const frames = await chrome.webNavigation
    .getAllFrames({ tabId })
    .catch(() => null);
  if (!frames) return; /* tab closed or query failed */
  for (const { frameId } of frames) {
    for (const message of messages) {
      chrome.tabs.sendMessage(tabId, message, { frameId }, () => {
        if (chrome.runtime.lastError) {
          /* frame may have no content script */
        }
      });
    }
  }
}

/**
 * Execute a plan produced by the pure routing.ts planners. An item with a
 * `frameId` targets that one frame; without one it goes to every frame in the
 * tab (see the note on {@link broadcastToAllFrames} — that is Chrome's
 * default, not top-frame-only). Errors (a frame with no content script) are
 * swallowed.
 */
function dispatchPlan(plan: PlannedTabMessage[]) {
  for (const item of plan) {
    const cb = () => {
      if (chrome.runtime.lastError) {
        /* frame may have no content script */
      }
    };
    if (item.frameId !== undefined) {
      chrome.tabs.sendMessage(
        item.tabId,
        item.body,
        { frameId: item.frameId },
        cb,
      );
    } else {
      chrome.tabs.sendMessage(item.tabId, item.body, cb);
    }
  }
}

// ---- Side-panel connection state ----
// Tracked as the source of truth for whether the focus tracker should be
// enabled in content scripts. Every time a frame's content script announces
// itself via FRAME_TREE_DATA, we re-assert the tracker state to that frame —
// avoiding the race where the panel's one-shot SET_FOCUS_TRACKER on mount
// arrives before the content script is listening.
let sidepanelConnected = false;
// The tabs whose panel has Focus sync off: the last SET_FOCUS_TRACKER a panel
// sent for each. The re-assert above sends this state, not always "on" — a
// page updates its tree after every burst of changes, which would otherwise
// turn a tracker the user switched off back on at once. Cleared with the last
// panel, whose disconnect turns every tracker off; a panel that connects
// sends its own state.
const focusTrackerOffTabs = new Set<number>();
// The tree each tab's panel last asked for, which a frame armed after that
// sends. Kept, and cleared, as Focus sync's state is.
const panelTrees = new Map<number, TreeRequest>();
// The connected side-panel ports. Chrome renders one side panel PER WINDOW, so
// there can be several at once — ref-counted here so the disconnect teardown
// runs only when the LAST panel closes (the panel-driven state below is global).
const sidepanelPorts = new Set<chrome.runtime.Port>();

// When the side panel connects, flip the flag. When it disconnects, tear down
// everything the panel was driving on the page:
//   1. Disable the focus tracker so `focusin` stops redrawing the overlay.
//   2. Remove any lingering overlay from every frame.
//   3. Lift the curtain — leaving it up after the panel closed would strand
//      the user staring at a black overlay with no UI to dismiss it.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidepanel") return;

  sidepanelPorts.add(port);
  sidepanelConnected = true;

  // A freshly-mounted panel learns its tab by itself, as its window's active
  // tab (see the panel's `myTabId`): only it knows which window it is in.

  // Arm observation on the active tab's already-loaded content scripts — they
  // announced via FRAME_HELLO before the panel existed and are waiting for
  // this. Frames that load later are armed by the FRAME_HELLO handler. On a
  // fresh service-worker instance (including SW-death revival, when the panel
  // reconnects its port) `activeTabId` is null until resolved, so resolve it
  // first — otherwise this re-arm would silently no-op.
  void (async () => {
    if (activeTabId === null) await refreshActiveTabFromLastFocusedWindow();
    if (activeTabId !== null) {
      await broadcastToAllFrames(activeTabId, {
        type: "SET_OBSERVING",
        payload: { enabled: true },
      });
    }
  })();

  port.onDisconnect.addListener(() => {
    sidepanelPorts.delete(port);
    // Only tear the panel-driven state down when the LAST panel closes.
    // Chrome renders one side panel PER WINDOW (each connects its own port),
    // but sidepanelConnected / activeTabId / the curtain store are global — so
    // closing one window's panel while another window's panel is still open
    // must NOT stop observing or lift the curtain on that other window.
    if (sidepanelPorts.size > 0) return;
    sidepanelConnected = false;
    focusTrackerOffTabs.clear();
    panelTrees.clear();
    releaseDebugger();

    // The panel arms the focus tracker (and observer) on any tab whose frames
    // announce while it is connected — background tabs included, and
    // FRAME_HELLO-only tabs that never reach `tabStates`. Left alone, those
    // tabs keep drawing focus overlays after the panel is gone and stay stuck
    // behind a curtain with no UI to dismiss it (and a stale curtain-store
    // entry re-applies the curtain on that tab's next navigation). Broadcasting
    // the teardown to EVERY tab is complete by construction; a tab that was
    // never armed simply no-ops on the idempotent messages. `chrome.tabs.query`
    // returns tab ids without the `tabs` permission.
    void Promise.all([chrome.tabs.query({}), curtains.hydrateCurtainState()])
      .then(([tabs]) => {
        // A panel reconnected while we were querying — leave its fresh state be.
        if (sidepanelConnected) return;

        // Hydration above matters after a service-worker death: the mirror is
        // empty on a fresh worker, so without it a curtain painted before the
        // teardown would never be lifted.
        const curtainTabs = curtains.takeCurtainTabs();

        const tabIds = tabs
          .map((t) => t.id)
          .filter((id): id is number => id !== undefined);
        const plan = planPanelDisconnectCleanupAllTabs({ tabIds, curtainTabs });

        // Group by tab so each tab's frames are enumerated once, not per message.
        const byTab = new Map<number, unknown[]>();
        for (const item of plan) {
          const list = byTab.get(item.tabId) ?? [];
          list.push(item.body);
          byTab.set(item.tabId, list);
        }
        for (const [tabId, messages] of byTab) {
          void broadcastMessagesToAllFrames(tabId, messages);
        }
      })
      .catch(() => {
        /* window/tab enumeration can fail during teardown; nothing to do */
      });
  });
});

// ---- Message handling ----

// Open side panel when extension action is clicked
chrome.action.onClicked.addListener((tab) => {
  if (tab.id) {
    void chrome.sidePanel.open({ tabId: tab.id });
  }
});

// `activeTabId` is the tab last switched to, in any window, or the active tab
// of the window the user last moved to: where a panel-originated message that
// names no tab of its own goes. Its legitimate writers:
//  - startup query below (cold start before any tab event fires)
//  - chrome.tabs.onActivated (user switches tabs within a window)
//  - chrome.windows.onFocusChanged (user switches windows)
//  - the REQUEST_TREE and CLOSE_TAB fallbacks below
// It used to also be rewritten on every inbound content-script message,
// which let any background tab silently steal active-tab status the
// moment one of its frames announced itself — so the side panel ended
// up showing the tree of an unrelated tab.
//
// The panels are told their tabs window by window, never `activeTabId`.
// Chrome gives every ordinary window a side panel of its own, showing that
// window's active tab, so each ACTIVE_TAB_CHANGED names the window whose
// panel it is for: moving to another window, or to a tab there, leaves this
// window's panel where it was. A popup, which has no panel, shows in the
// last ordinary window's (`panelWindowFor`) from when the user moves to it.
// That panel goes back to its own window's tab when the popup closes
// (TAB_CLOSED), when a tab is switched to in its window, or when the user
// moves to that window's page from another window. Not when they move to the
// panel itself: it is in that window too, and must stay on the popup they
// came to it for (`focus`).

/** The last ordinary window the user was in: a popup shows in its panel. */
let lastNormalWindowId: number | null = null;

/** Windows closed in the last minute, longer than any look-up takes. A
 *  look-up that answers after its window closed must not make that window
 *  the one popups show in, nor a guess of Chrome's that answers late. */
const closedWindows = new Set<number>();
const CLOSED_WINDOW_KEPT_MS = 60_000;

/** Orders what the look-ups below write: `"active"` is `activeTabId`,
 *  `"normal"` is `lastNormalWindowId`, and a window's id is its panel. */
const lookups = lookupOrder<number | "active" | "normal">();

/** Set `activeTabId`, unless a look-up newer than `since` already has. */
function setActiveTab(tabId: number, since?: number): void {
  if (lookups.claim("active", since)) activeTabId = tabId;
}

/**
 * Tell window `windowId`'s side panel which tab it shows, unless a look-up
 * newer than `since` already has. The panel uses this as the source of truth
 * for `myTabId` rather than its own `chrome.tabs.onActivated` listener — the
 * panel context's listener is unreliable in some Chrome configurations (no
 * `"tabs"` permission, plus historical sidepanel quirks), but the
 * background's listener is authoritative. Every panel hears it, and only
 * `windowId`'s takes it. `focus` marks the window's own tab, told because the
 * user moved to the window. Cheap; safe to fire often.
 */
function tellPanel(
  tabId: number,
  windowId: number,
  since?: number,
  focus = false,
): void {
  if (!lookups.claim(windowId, since)) return;
  const message: Extract<ContentToPanel, { type: "ACTIVE_TAB_CHANGED" }> = {
    type: "ACTIVE_TAB_CHANGED",
    tabId,
    windowId,
    ...(focus ? { focus } : {}),
  };
  chrome.runtime.sendMessage(message).catch(() => {
    // Panel may be closed; benign.
  });
}

/**
 * The user is in window `windowId`, by a look-up stamped `since`: its active
 * tab (`activeTab`, when the caller has it) becomes `activeTabId`, and with
 * `tell`, the panel that shows the window is told it. That is the window's
 * own panel, which may have been showing a popup, or for a popup, the last
 * ordinary window's.
 */
async function followWindow(
  windowId: number,
  since: number,
  tell: boolean,
  activeTab?: chrome.tabs.Tab,
): Promise<void> {
  const [win, tab] = await Promise.all([
    chrome.windows.get(windowId),
    activeTab ??
      chrome.tabs.query({ active: true, windowId }).then(([found]) => found),
  ]);
  if (tab?.id === undefined || closedWindows.has(windowId)) return;
  setActiveTab(tab.id, since);
  if (win.type === "normal") {
    if (lookups.claim("normal", since)) lastNormalWindowId = windowId;
  } else if (lastNormalWindowId === null) {
    // A worker that started while a popup had focus hasn't seen the user in
    // an ordinary window yet: Chrome's pick of one, right when there is one.
    const normal = await chrome.windows.getLastFocused({
      windowTypes: ["normal"],
    });
    if (
      normal.id !== undefined &&
      !closedWindows.has(normal.id) &&
      lookups.claim("normal", since)
    ) {
      lastNormalWindowId = normal.id;
    }
  }
  if (!tell) return;
  const panelWindow = panelWindowFor({
    windowId,
    windowType: win.type,
    lastNormalWindowId,
  });
  if (panelWindow === null) return;
  tellPanel(tab.id, panelWindow, since, panelWindow === windowId);
}

async function refreshActiveTabFromLastFocusedWindow(): Promise<void> {
  const since = lookups.begin();
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tab?.id === undefined) return;
    await followWindow(tab.windowId, since, false, tab);
  } catch {
    // Service worker can be invoked before any window exists; ignore.
  }
}

void refreshActiveTabFromLastFocusedWindow();

chrome.tabs.onActivated.addListener(({ tabId, windowId }) => {
  setActiveTab(tabId);
  tellPanel(tabId, windowId);
});

// Switching between windows doesn't fire onActivated. A window's own panel
// is told its tab again, in case it was showing a popup.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  followWindow(windowId, lookups.begin(), true).catch(() => {
    // The window closed before it could be looked at; nothing to follow.
  });
});

// A closed window has no panel to show a popup in: the next popup goes to
// Chrome's pick of an ordinary window (see `followWindow`).
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === lastNormalWindowId) lastNormalWindowId = null;
  lookups.forget(windowId);
  closedWindows.add(windowId);
  setTimeout(() => closedWindows.delete(windowId), CLOSED_WINDOW_KEPT_MS);
});

// Route messages between frames, side panel, and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Reject anything not sent by our own extension's contexts (content
  // scripts, side panel). onMessage is same-extension only, so this never
  // fires in practice — but the branches below trust `sender.tab` and route
  // powerful commands (CLOSE_TAB, SEND_KEY, DISPATCH_ACTION) to the active
  // tab, so the trust boundary is worth asserting explicitly here.
  if (!isTrustedSender(sender, chrome.runtime.id)) return false;

  // Native-mode messages have their own onMessage listener (native/index.ts,
  // registered in every build). They carry no `sender.tab`, so without this
  // guard they fall through to the catch-all fallback below, which would
  // forward a meaningless message to the active tab or, with no active tab,
  // race a synchronous `{ success:false }` reply against the native handler's
  // slower async one. Leave them to the native listener.
  if (typeof message?.type === "string" && message.type.startsWith("NATIVE_")) {
    return false;
  }

  // ---- Messages from content script frames ----
  if (sender.tab?.id) {
    const tabId = sender.tab.id;
    const frameId = sender.frameId ?? 0;

    switch (message.type) {
      case "FRAME_TREE_DATA": {
        // Store this frame's tree and schedule a merge
        const state = getTabState(tabId);
        const { isNewTopFrame } = recordFrameTree(state, {
          frameId,
          frameUrl: message.payload.frameUrl,
          pageTitle: message.payload.pageTitle || "",
          nodes: message.payload.nodes,
          rootId: message.payload.rootId,
          ...asFrameMarks(message.payload),
          ...(message.payload.framesOnly === true ? { framesOnly: true } : {}),
        });
        // A frame asked where one of its frames goes has now answered.
        answeredPlacesAskedOf(state, frameId);
        if (message.payload.reread !== true) {
          // The page's clock, which can't be ahead of now.
          const now = Date.now();
          const stamp = message.payload.changedAt;
          const at =
            typeof stamp === "number" && Number.isFinite(stamp)
              ? Math.min(stamp, now)
              : now;
          const before = state.changedFrames.get(frameId);
          state.changedFrames.set(frameId, Math.max(before ?? at, at));
        }
        scheduleMerge(tabId);

        // Decide what to send back to the frame(s). Rules are in routing.ts
        // (unit-tested there) — this block just dispatches the plan.
        const plan = planFrameAnnouncementResponse({
          tabId,
          frameId,
          isNewTopFrame,
          sidepanelConnected,
          curtainOn: curtains.isCurtainOn(tabId),
          focusTracker: !focusTrackerOffTabs.has(tabId),
          tree: panelTrees.get(tabId),
        });
        dispatchPlan(plan);

        sendResponse({ received: true });
        return false;
      }

      case "FRAME_HELLO": {
        // A frame just loaded and announced itself WITHOUT extracting. If a
        // panel is connected for the tab, tell it to start observing (and
        // enable the focus tracker). Otherwise do nothing — no extraction.
        dispatchPlan(
          planFrameHello({
            tabId,
            frameId,
            sidepanelConnected,
            focusTracker: !focusTrackerOffTabs.has(tabId),
            tree: panelTrees.get(tabId),
          }),
        );
        sendResponse({ received: true });
        return false;
      }

      case "FOCUS_CHANGED": {
        // Forward to the side panel. Stamp `tabId` so the panel can drop
        // focus events for tabs it isn't bound to. The native tree's page
        // keys number the reporting frame's own document
        // (`NATIVE_PAGE_KEYS`), so they go with that frame.
        const { pageKeys } = message.payload;
        chrome.runtime
          .sendMessage({
            type: "FOCUS_CHANGED",
            tabId,
            payload: { pageKeys, frameId },
          })
          .catch((err) => {
            // Panel may be closed; benign, but log so real routing bugs aren't invisible.
            console.debug(
              "[SN background] FOCUS_CHANGED forward failed:",
              err?.message ?? err,
            );
          });
        sendResponse({ received: true });
        return false;
      }

      case "LIVE_REGION":
      case "PAGE_INPUT":
      case "PAGE_TYPING": {
        // No-op: chrome.runtime.sendMessage from the content script
        // already delivers to the sidepanel directly.  Forwarding here
        // caused every announcement to appear twice.
        sendResponse({ received: true });
        return false;
      }

      default: {
        // Forward any other content script messages to side panel, stamping
        // tabId so the panel can filter by its bound tab.
        chrome.runtime.sendMessage({ ...message, tabId }).catch((err) => {
          // Panel may be closed; benign, but log so real routing bugs aren't invisible.
          console.debug(
            "[SN background] forward to panel failed:",
            err?.message ?? err,
          );
        });
        sendResponse({ received: true });
        return false;
      }
    }
  }

  // ---- Messages from side panel → route to content scripts ----
  // Prefer the panel-stamped `tabId` (the tab the panel is bound to) over
  // the global `activeTabId`. After a tab switch, `chrome.tabs.onActivated`
  // updates `activeTabId` before the panel processes `ACTIVE_TAB_CHANGED`
  // and clears its tree — so routing by `activeTabId` alone can fire
  // DISPATCH_ACTION / SEND_KEY / CLOSE_TAB on the newly active tab while
  // the panel still shows the previous tab's nodes (ids are a per-frame
  // counter, so `sn-3` resolves to an unrelated element there).
  // See resolvePanelTargetTab.

  // Broadcast messages: send to ALL frames.
  if (
    message.type === "REQUEST_TREE" ||
    message.type === "SET_VIEW_MODE" ||
    message.type === "SET_FOCUS_TRACKER"
  ) {
    const targetTabId = resolvePanelTargetTab(
      (message as { tabId?: number }).tabId,
      activeTabId,
    );
    // One responder for both routes. Answering from inside the send callback
    // is the whole point — until Chrome runs it, whether ANY frame took the
    // message is unknown, and a premature `success: true` is
    // indistinguishable from a page the extension can never reach. Keeping it
    // in one place also means neither route can be left silently not
    // answering, which would hang the panel on an open message channel.
    const broadcast = (tabId: number) => {
      if (message.type === "SET_FOCUS_TRACKER") {
        if (message.payload.enabled) focusTrackerOffTabs.delete(tabId);
        else focusTrackerOffTabs.add(tabId);
      } else {
        panelTrees.set(tabId, {
          framesOnly: message.payload.framesOnly === true,
        });
      }
      // Clear old frame data on fresh request
      if (message.type === "REQUEST_TREE") {
        clearTabFrames(getTabState(tabId));
        // Remember that a panel is waiting, so the answer gets published even
        // on a worker revived by this very message (see panelTreeRequests).
        panelTreeRequests.add(tabId);
      }
      chrome.tabs.sendMessage(tabId, message, () => {
        sendResponse(describeBroadcastDelivery(chrome.runtime.lastError));
      });
    };

    if (targetTabId !== null) {
      broadcast(targetTabId);
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId) {
          setActiveTab(tabId);
          broadcast(tabId);
        } else {
          sendResponse({ success: false, error: "No active tab" });
        }
      });
    }
    return true;
  }

  // Close the panel-bound tab (for dismissing popups, login windows, etc.).
  // After closing, focus back to the previous window (e.g., the original page).
  // The follow-up REQUEST_TREE uses the *newly* active tab — not the closed
  // tab's stamped id.
  if (message.type === "CLOSE_TAB") {
    const closingTabId = resolvePanelTargetTab(
      (message as { tabId?: number }).tabId,
      activeTabId,
    );
    // The tree this panel asks for, for the tab it shows next: read before
    // the tab's removal forgets it.
    const tree =
      closingTabId == null ? undefined : panelTrees.get(closingTabId);
    if (closingTabId != null) {
      chrome.tabs.remove(closingTabId, () => {
        if (chrome.runtime.lastError) {
          sendResponse({
            success: false,
            error: chrome.runtime.lastError.message,
          });
          return;
        }
        // Focus the last focused window and update activeTabId
        chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
          const nowActive = tabs[0]?.id;
          if (nowActive) {
            setActiveTab(nowActive);
            chrome.windows.update(tabs[0].windowId!, { focused: true }, () => {
              if (chrome.runtime.lastError) {
                /* the window closed meanwhile */
              }
            });
            // Request fresh tree from the now-active tab
            chrome.tabs.sendMessage(
              nowActive,
              {
                type: "REQUEST_TREE",
                payload: tree ??
                  panelTrees.get(nowActive) ?? { framesOnly: true },
              },
              () => {
                if (chrome.runtime.lastError) {
                  /* ignore */
                }
              },
            );
          }
          sendResponse({ success: true });
        });
      });
    } else {
      sendResponse({ success: false, error: "No active tab" });
    }
    return true;
  }

  // Curtain toggle — store state and broadcast
  if (message.type === "TOGGLE_CURTAIN") {
    const targetTabId = resolvePanelTargetTab(
      (message as { tabId?: number }).tabId,
      activeTabId,
    );
    if (targetTabId != null) {
      curtains.setCurtain(targetTabId, message.payload.visible);
      chrome.tabs.sendMessage(targetTabId, message, () => {
        if (chrome.runtime.lastError) {
          /* ignore */
        }
      });
    }
    sendResponse({ success: true });
    return false;
  }

  // Broadcast to all frames
  if (message.type === "CLEAR_HIGHLIGHT") {
    const targetTabId = resolvePanelTargetTab(
      (message as { tabId?: number }).tabId,
      activeTabId,
    );
    if (targetTabId != null) {
      chrome.tabs.sendMessage(targetTabId, message, () => {
        if (chrome.runtime.lastError) {
          /* ignore */
        }
      });
    }
    sendResponse({ success: true });
    return false;
  }

  // Send keyboard event to top frame
  if (message.type === "SEND_KEY") {
    const targetTabId = resolvePanelTargetTab(
      (message as { tabId?: number }).tabId,
      activeTabId,
    );
    if (targetTabId != null) {
      chrome.tabs.sendMessage(
        targetTabId,
        message,
        { frameId: 0 },
        (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              success: false,
              error: "Content script not available",
            });
          } else {
            sendResponse(response);
          }
        },
      );
    } else {
      sendResponse({ success: false, error: "No active tab" });
    }
    return true;
  }

  // Targeted messages: route to the specific frame that owns the node
  if (
    message.type === "DISPATCH_ACTION" ||
    message.type === "HIGHLIGHT_NODE" ||
    message.type === "GET_FIELD_STATE"
  ) {
    const targetTabId = resolvePanelTargetTab(
      (message as { tabId?: number }).tabId,
      activeTabId,
    );
    if (targetTabId == null) {
      sendResponse({ success: false, error: "No active tab" });
      return false;
    }

    const nodeId: string = message.payload.nodeId;
    const { frameId, localId } = parseNodeId(nodeId);

    // Build the message with the frame-local nodeId
    const frameMessage = {
      ...message,
      payload: { ...message.payload, nodeId: localId },
    };

    chrome.tabs.sendMessage(
      targetTabId,
      frameMessage,
      { frameId },
      (response) => {
        if (chrome.runtime.lastError) {
          sendResponse({ success: false, error: "Frame not available" });
        } else {
          sendResponse(response);
        }
      },
    );
    return true; // Keep channel open for async response
  }

  // Fallback: forward to the panel-bound tab (top frame)
  {
    const targetTabId = resolvePanelTargetTab(
      (message as { tabId?: number }).tabId,
      activeTabId,
    );
    if (targetTabId != null) {
      chrome.tabs.sendMessage(
        targetTabId,
        message,
        { frameId: 0 },
        (response) => {
          if (chrome.runtime.lastError) {
            sendResponse({
              success: false,
              error: "Content script not available",
            });
          } else {
            sendResponse(response);
          }
        },
      );
    } else {
      sendResponse({ success: false, error: "No active tab" });
    }
  }

  return true;
});

// ---- Frame lifecycle ----

// When a frame navigates away, remove its tree and re-merge
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  const state = tabStates.get(details.tabId);
  if (!state) return;

  if (details.frameId === 0) {
    // Top frame navigating — clear ALL frame data for this tab
    clearTabFrames(state);
    forgetAskedPlaces(state);
    // And tell the panel, which holds its own copy. Nothing else would:
    // a tree only reaches it when some frame announces, so navigating to a
    // page that cannot run a content script (the Web Store, a PDF, a
    // chrome:// page) left the PREVIOUS page's tree on screen indefinitely.
    // That is worse than empty — node ids are a per-frame counter, so the
    // stale rows resolve to unrelated elements on the new page, the same
    // hazard the bfcache refresh exists to prevent.
    //
    // Deliberately just "drop it", not "go fetch a new one": the content
    // script is injected at `document_idle`, so anything asked now lands in
    // the gap before the new document has one and would come back looking
    // exactly like a restricted page. On an ordinary page the new content
    // script announces on load and the tree repopulates on its own; on one
    // that can't, the panel offers Load tree, which answers honestly.
    chrome.runtime
      .sendMessage({ type: "PAGE_NAVIGATED", tabId: details.tabId })
      .catch(() => {
        // Side panel might not be open
      });
  } else {
    // Subframe navigating — remove just this frame's data
    const { shouldRemerge } = removeFrame(state, details.frameId);
    if (shouldRemerge) scheduleMerge(details.tabId);
  }
});

// Clean up on tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  disposeTabState(tabStates, tabId);
  curtains.forgetTab(tabId);
  panelTreeRequests.delete(tabId);
  focusTrackerOffTabs.delete(tabId);
  panelTrees.delete(tabId);
  // A panel showing a popup is told nothing else when the popup closes: no
  // tab is switched to in the panel's own window, so it asks for that
  // window's tab itself.
  const closed: Extract<ContentToPanel, { type: "TAB_CLOSED" }> = {
    type: "TAB_CLOSED",
    tabId,
  };
  chrome.runtime.sendMessage(closed).catch(() => {
    // No panel open; benign.
  });
});

// Set side panel behavior
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err) => {
    // Non-fatal: extension still works, user just has to click the icon twice.
    console.warn(
      "[SN background] setPanelBehavior failed:",
      err?.message ?? err,
    );
  });
