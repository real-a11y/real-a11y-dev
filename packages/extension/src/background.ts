/// <reference types="chrome" />

import { buildFrameInfoMap, mergeFrameTrees } from "./frame-merger.js";
import {
  prefixNodeId,
  parseNodeId,
  planFrameAnnouncementResponse,
  planPanelDisconnectCleanup,
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

// ---- Side-panel connection state ----
// Tracked as the source of truth for whether the focus tracker should be
// enabled in content scripts. Every time a frame's content script announces
// itself via FRAME_TREE_DATA, we re-assert the tracker state to that frame —
// avoiding the race where the panel's one-shot SET_FOCUS_TRACKER on mount
// arrives before the content script is listening.
let sidepanelConnected = false;

// When the side panel connects, flip the flag. When it disconnects, tear down
// everything the panel was driving on the page:
//   1. Disable the focus tracker so `focusin` stops redrawing the overlay.
//   2. Remove any lingering overlay from every frame.
//   3. Lift the curtain — leaving it up after the panel closed would strand
//      the user staring at a black overlay with no UI to dismiss it.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "sidepanel") return;

  sidepanelConnected = true;

  // The freshly-mounted panel needs to know which tab it's bound to before
  // it can request a tree or filter inbound messages. Push the current
  // activeTabId immediately on connect.
  broadcastActiveTabToPanel();

  port.onDisconnect.addListener(() => {
    sidepanelConnected = false;
    if (!activeTabId) return;
    const curtainWasOn = !!tabCurtainOn.get(activeTabId);
    const plan = planPanelDisconnectCleanup({
      tabId: activeTabId,
      curtainOn: curtainWasOn,
    });
    for (const item of plan) {
      broadcastToAllFrames(item.tabId, item.body);
    }
    if (curtainWasOn) tabCurtainOn.set(activeTabId, false);
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
        for (const item of plan) {
          const cb = () => {
            if (chrome.runtime.lastError) {
              /* ignore */
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
