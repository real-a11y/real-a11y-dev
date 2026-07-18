/// <reference types="chrome" />

import { buildFrameInfoMap, mergeFrameTrees } from "./frame-merger.js";
import {
  type PlannedTabMessage,
  isTrustedSender,
  prefixNodeId,
  parseNodeId,
  planFrameAnnouncementResponse,
  planFrameHello,
  planPanelDisconnectCleanupAllTabs,
} from "./routing.js";
import {
  type TabState,
  clearTabFrames,
  disposeTabState,
  getOrCreateTabState,
  recordFrameTree,
  removeFrame,
} from "./tab-state.js";

// ---- Per-tab frame state ----
// Pure state-machine helpers live in ./tab-state, the merge algorithm in
// ./frame-merger, and the Chrome side-effects below.

const tabStates = new Map<number, TabState>();
const tabCurtainOn = new Map<number, boolean>(); // curtain state per tab
let activeTabId: number | null = null;

function getTabState(tabId: number): TabState {
  return getOrCreateTabState(tabStates, tabId);
}

// ---- Frame tree merging ----

async function mergeAndSendTree(tabId: number) {
  // No panel means nobody consumes the merged tree — skip the getAllFrames
  // call, the merge, the node clone, and the (dropped) sendMessage. Content
  // scripts only send FRAME_TREE_DATA while observing (panel-gated), so this
  // mainly guards stale in-flight data arriving just as the panel closes.
  if (!sidepanelConnected) return;
  const state = getTabState(tabId);
  const topFrame = state.frames.get(0);
  if (!topFrame) return;

  let allFrames: chrome.webNavigation.GetAllFrameResultDetails[] = [];
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (frames) allFrames = frames;
  } catch {
    // Tab might be closed or invalid
  }

  const result = mergeFrameTrees({
    frames: state.frames,
    frameInfoMap: buildFrameInfoMap(allFrames),
  });
  if (!result) return; // top frame went away between schedule and run

  state.nodeToFrame = result.nodeToFrame;

  // Send merged tree to side panel with page info. `tabId` lets the side
  // panel filter out broadcasts for tabs it isn't bound to — without that
  // any background tab's tree update leaks into every open panel.
  const serialized = Array.from(result.nodes.entries());
  chrome.runtime
    .sendMessage({
      type: "TREE_DATA",
      tabId,
      payload: {
        nodes: serialized,
        rootId: topFrame.rootId,
        pageTitle: topFrame.pageTitle,
        pageUrl: topFrame.frameUrl,
      },
    })
    .catch(() => {
      // Side panel might not be open
    });
}

function scheduleMerge(tabId: number) {
  const state = getTabState(tabId);
  if (state.mergeTimer) clearTimeout(state.mergeTimer);
  state.mergeTimer = setTimeout(() => {
    state.mergeTimer = null;
    mergeAndSendTree(tabId);
  }, 200);
}

// ---- Side panel lifecycle ----

/**
 * Broadcast a message to every frame of the given tab. Content scripts run
 * in all frames (manifest `all_frames: true`), but `chrome.tabs.sendMessage`
 * without an explicit `frameId` targets only the top frame — so iframe
 * overlays and focus-tracker state would otherwise drift on panel close.
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
 * `frameId` targets that one frame; without one it goes to the tab (top
 * frame). Errors (a frame with no content script) are swallowed.
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

  // The freshly-mounted panel needs to know which tab it's bound to before
  // it can request a tree or filter inbound messages. Push the current
  // activeTabId immediately on connect.
  broadcastActiveTabToPanel();

  // Arm observation on the active tab's already-loaded content scripts — they
  // announced via FRAME_HELLO before the panel existed and are waiting for
  // this. Frames that load later are armed by the FRAME_HELLO handler. On a
  // fresh service-worker instance (including SW-death revival, when the panel
  // reconnects its port) `activeTabId` is null until resolved, so resolve it
  // first — otherwise this re-arm would silently no-op.
  void (async () => {
    if (activeTabId === null) await refreshActiveTabFromLastFocusedWindow();
    if (activeTabId !== null) {
      broadcastToAllFrames(activeTabId, {
        type: "SET_OBSERVING",
        payload: { enabled: true },
      });
    }
  })();

  port.onDisconnect.addListener(() => {
    sidepanelPorts.delete(port);
    // Only tear the panel-driven state down when the LAST panel closes.
    // Chrome renders one side panel PER WINDOW (each connects its own port),
    // but sidepanelConnected / activeTabId / tabCurtainOn are global — so
    // closing one window's panel while another window's panel is still open
    // must NOT stop observing or lift the curtain on that other window.
    if (sidepanelPorts.size > 0) return;
    sidepanelConnected = false;

    // The panel arms the focus tracker (and observer) on any tab whose frames
    // announce while it is connected — background tabs included, and
    // FRAME_HELLO-only tabs that never reach `tabStates`. Left alone, those
    // tabs keep drawing focus overlays after the panel is gone and stay stuck
    // behind a curtain with no UI to dismiss it (and a stale `tabCurtainOn`
    // entry re-applies the curtain on that tab's next navigation). Broadcasting
    // the teardown to EVERY tab is complete by construction; a tab that was
    // never armed simply no-ops on the idempotent messages. `chrome.tabs.query`
    // returns tab ids without the `tabs` permission.
    void chrome.tabs
      .query({})
      .then((tabs) => {
        // A panel reconnected while we were querying — leave its fresh state be.
        if (sidepanelConnected) return;

        const curtainTabs = new Set<number>();
        for (const [tabId, on] of tabCurtainOn) if (on) curtainTabs.add(tabId);
        tabCurtainOn.clear();

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
    chrome.sidePanel.open({ tabId: tab.id });
  }
});

// `activeTabId` tracks the user-visible active tab so panel-originated
// messages get routed to the right page. Three legitimate writers:
//  - startup query below (cold start before any tab event fires)
//  - chrome.tabs.onActivated (user switches tabs within a window)
//  - chrome.windows.onFocusChanged (user switches windows)
// It used to also be rewritten on every inbound content-script message,
// which let any background tab silently steal active-tab status the
// moment one of its frames announced itself — so the side panel ended
// up showing the tree of an unrelated tab.

async function refreshActiveTabFromLastFocusedWindow(): Promise<void> {
  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });
    if (tab?.id !== undefined) {
      activeTabId = tab.id;
      broadcastActiveTabToPanel();
    }
  } catch {
    // Service worker can be invoked before any window exists; ignore.
  }
}

/**
 * Tell the side panel which tab is currently active. The panel uses this
 * as the source of truth for `myTabId` rather than its own
 * `chrome.tabs.onActivated` listener — the panel context's listener is
 * unreliable in some Chrome configurations (no `"tabs"` permission, plus
 * historical sidepanel quirks), but the background's listener is
 * authoritative because that's what tracks `activeTabId` in the first
 * place. Idempotent and cheap; safe to fire often.
 */
function broadcastActiveTabToPanel(): void {
  if (activeTabId === null) return;
  chrome.runtime
    .sendMessage({ type: "ACTIVE_TAB_CHANGED", tabId: activeTabId })
    .catch(() => {
      // Panel may be closed; benign.
    });
}

void refreshActiveTabFromLastFocusedWindow();

chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
  broadcastActiveTabToPanel();
});

// Switching between windows doesn't fire onActivated, so refresh here too.
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) return;
  void refreshActiveTabFromLastFocusedWindow();
});

// Route messages between frames, side panel, and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Reject anything not sent by our own extension's contexts (content
  // scripts, side panel). onMessage is same-extension only, so this never
  // fires in practice — but the branches below trust `sender.tab` and route
  // powerful commands (CLOSE_TAB, SEND_KEY, DISPATCH_ACTION) to the active
  // tab, so the trust boundary is worth asserting explicitly here.
  if (!isTrustedSender(sender, chrome.runtime.id)) return false;

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
        });
        scheduleMerge(tabId);

        // Decide what to send back to the frame(s). Rules are in routing.ts
        // (unit-tested there) — this block just dispatches the plan.
        const plan = planFrameAnnouncementResponse({
          tabId,
          frameId,
          isNewTopFrame,
          sidepanelConnected,
          curtainOn: !!tabCurtainOn.get(tabId),
        });
        dispatchPlan(plan);

        sendResponse({ received: true });
        return false;
      }

      case "FRAME_HELLO": {
        // A frame just loaded and announced itself WITHOUT extracting. If a
        // panel is connected for the tab, tell it to start observing (and
        // enable the focus tracker). Otherwise do nothing — no extraction.
        dispatchPlan(planFrameHello({ tabId, frameId, sidepanelConnected }));
        sendResponse({ received: true });
        return false;
      }

      case "FOCUS_CHANGED": {
        // Prefix the nodeId and forward to side panel. Stamp `tabId` so
        // the panel can drop focus events for tabs it isn't bound to.
        const prefixedNodeId = prefixNodeId(frameId, message.payload.nodeId);
        chrome.runtime
          .sendMessage({
            type: "FOCUS_CHANGED",
            tabId,
            payload: { nodeId: prefixedNodeId },
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

      case "NODE_PICKED": {
        // Same shape as FOCUS_CHANGED — the content script reports a
        // frame-local nodeId; prefix it with the originating frameId
        // so the panel resolves it against the merged tree.
        const prefixedNodeId = prefixNodeId(frameId, message.payload.nodeId);
        chrome.runtime
          .sendMessage({
            type: "NODE_PICKED",
            tabId,
            payload: { nodeId: prefixedNodeId },
          })
          .catch((err) => {
            console.debug(
              "[SN background] NODE_PICKED forward failed:",
              err?.message ?? err,
            );
          });
        sendResponse({ received: true });
        return false;
      }

      case "LIVE_REGION": {
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

  // Broadcast messages: send to ALL frames. Prefer the tabId the panel
  // explicitly tagged the message with (it knows its own tab) over the
  // background's `activeTabId` (which races with `chrome.tabs.onActivated`
  // — REQUEST_TREE fired right after a tab switch can land before
  // activeTabId has been updated, routing to the previous tab).
  if (
    message.type === "REQUEST_TREE" ||
    message.type === "SET_VIEW_MODE" ||
    message.type === "SET_FOCUS_TRACKER"
  ) {
    const targetTabId =
      (message as { tabId?: number }).tabId ?? activeTabId ?? null;
    if (targetTabId !== null) {
      // Clear old frame data on fresh request
      if (message.type === "REQUEST_TREE") {
        clearTabFrames(getTabState(targetTabId));
      }
      chrome.tabs.sendMessage(targetTabId, message, () => {
        if (chrome.runtime.lastError) {
          // Some frames might not have the content script
        }
      });
      sendResponse({ success: true });
    } else {
      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        const tabId = tabs[0]?.id;
        if (tabId) {
          activeTabId = tabId;
          if (message.type === "REQUEST_TREE") {
            clearTabFrames(getTabState(tabId));
          }
          chrome.tabs.sendMessage(tabId, message, () => {
            if (chrome.runtime.lastError) {
              /* ignore */
            }
          });
          sendResponse({ success: true });
        } else {
          sendResponse({ success: false, error: "No active tab" });
        }
      });
    }
    return true;
  }

  // Close the active tab (for dismissing popups, login windows, etc.)
  // After closing, focus back to the previous window (e.g., the original page)
  if (message.type === "CLOSE_TAB") {
    if (activeTabId) {
      const closingTabId = activeTabId;
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
          if (tabs[0]?.id) {
            activeTabId = tabs[0].id;
            chrome.windows.update(tabs[0].windowId!, { focused: true });
            // Request fresh tree from the now-active tab
            chrome.tabs.sendMessage(
              activeTabId,
              {
                type: "REQUEST_TREE",
                payload: { viewMode: "a11y" },
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
    if (activeTabId) {
      tabCurtainOn.set(activeTabId, message.payload.visible);
      chrome.tabs.sendMessage(activeTabId, message, () => {
        if (chrome.runtime.lastError) {
          /* ignore */
        }
      });
    }
    sendResponse({ success: true });
    return false;
  }

  // Picker toggle — broadcast to every frame so a click inside an iframe
  // also picks an element. NODE_PICKED comes back through the default
  // content→panel forwarder below (with `tabId` stamped on).
  if (message.type === "SET_PICK_MODE") {
    if (activeTabId) {
      broadcastToAllFrames(activeTabId, message);
    }
    sendResponse({ success: true });
    return false;
  }

  // Broadcast to all frames
  if (message.type === "CLEAR_HIGHLIGHT") {
    if (activeTabId) {
      chrome.tabs.sendMessage(activeTabId, message, () => {
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
    if (activeTabId) {
      chrome.tabs.sendMessage(
        activeTabId,
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
    if (!activeTabId) {
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
      activeTabId,
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

  // Fallback: forward to active tab (top frame)
  if (activeTabId) {
    chrome.tabs.sendMessage(
      activeTabId,
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
});

// ---- Frame lifecycle ----

// When a frame navigates away, remove its tree and re-merge
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  const state = tabStates.get(details.tabId);
  if (!state) return;

  if (details.frameId === 0) {
    // Top frame navigating — clear ALL frame data for this tab
    clearTabFrames(state);
  } else {
    // Subframe navigating — remove just this frame's data
    const { shouldRemerge } = removeFrame(state, details.frameId);
    if (shouldRemerge) scheduleMerge(details.tabId);
  }
});

// Clean up on tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  disposeTabState(tabStates, tabId);
  tabCurtainOn.delete(tabId);
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
