/// <reference types="chrome" />

import type { SemanticNode } from "@real-a11y-dev/core";

import {
  prefixNodeId,
  parseNodeId,
  urlsMatch,
  planFrameAnnouncementResponse,
  planPanelDisconnectCleanup,
} from "./routing.js";

// ---- Per-tab frame state ----

interface FrameTree {
  frameId: number;
  frameUrl: string;
  pageTitle: string;
  nodes: Array<[string, SemanticNode]>;
  rootId: string;
}

interface TabState {
  frames: Map<number, FrameTree>;
  nodeToFrame: Map<string, number>; // prefixed nodeId → frameId
  mergeTimer: ReturnType<typeof setTimeout> | null;
}

const tabStates = new Map<number, TabState>();
const tabCurtainOn = new Map<number, boolean>(); // curtain state per tab
let activeTabId: number | null = null;

function getTabState(tabId: number): TabState {
  let state = tabStates.get(tabId);
  if (!state) {
    state = { frames: new Map(), nodeToFrame: new Map(), mergeTimer: null };
    tabStates.set(tabId, state);
  }
  return state;
}

// Node-id prefixing, url-normalize, and url-match helpers live in ./routing
// so they can be unit-tested without pulling in the Chrome APIs.

// ---- Frame tree merging ----

async function mergeAndSendTree(tabId: number) {
  const state = getTabState(tabId);
  const topFrame = state.frames.get(0);
  if (!topFrame) return;

  // Get frame hierarchy from Chrome
  let allFrames: chrome.webNavigation.GetAllFrameResultDetails[] = [];
  try {
    const frames = await chrome.webNavigation.getAllFrames({ tabId });
    if (frames) allFrames = frames;
  } catch {
    // Tab might be closed or invalid
  }

  // Build a map of frameId → frame info
  const frameInfoMap = new Map<
    number,
    { parentFrameId: number; url: string }
  >();
  for (const f of allFrames) {
    frameInfoMap.set(f.frameId, { parentFrameId: f.parentFrameId, url: f.url });
  }

  // Start with top frame nodes
  const mergedNodes = new Map<string, SemanticNode>();
  const nodeToFrame = new Map<string, number>();

  for (const [nodeId, node] of topFrame.nodes) {
    mergedNodes.set(nodeId, { ...node });
    nodeToFrame.set(nodeId, 0);
  }

  // Process child frames — sorted by parent depth to handle nesting
  const childFrameIds = Array.from(state.frames.keys()).filter(
    (id) => id !== 0,
  );

  for (const childFrameId of childFrameIds) {
    const childTree = state.frames.get(childFrameId);
    if (!childTree) continue;

    const frameInfo = frameInfoMap.get(childFrameId);
    const parentFrameId = frameInfo?.parentFrameId ?? 0;

    // Find the parent frame's tree to locate the <iframe> attachment point
    const parentTree =
      parentFrameId === 0 ? topFrame : state.frames.get(parentFrameId);
    if (!parentTree) continue;

    // Find the iframe node in the parent tree that matches this frame's URL
    const parentFrameUrl = parentTree.frameUrl;
    let iframeNodeId: string | null = null;
    let iframeDepth = 0;

    for (const [nodeId, node] of parentTree.nodes) {
      if (node.dom.tagName === "iframe") {
        const src = node.dom.attributes.src || "";
        if (urlsMatch(src, childTree.frameUrl, parentFrameUrl)) {
          // Prefix the parent node ID if it's not the top frame
          iframeNodeId = prefixNodeId(parentFrameId, nodeId);
          const parentNode = mergedNodes.get(iframeNodeId);
          iframeDepth = parentNode?.depth ?? node.depth;
          break;
        }
      }
    }

    if (!iframeNodeId) {
      // Fallback: try matching by URL from webNavigation
      if (frameInfo) {
        for (const [nodeId, node] of parentTree.nodes) {
          if (node.dom.tagName === "iframe") {
            const prefId = prefixNodeId(parentFrameId, nodeId);
            const parentNode = mergedNodes.get(prefId);
            // Check if this iframe node already has frame children attached
            if (parentNode && parentNode.childIds.length === 0) {
              iframeNodeId = prefId;
              iframeDepth = parentNode.depth;
              break;
            }
          }
        }
      }
    }

    // Prefix child frame node IDs and adjust depths
    const prefix = childFrameId;
    const depthOffset = iframeNodeId ? iframeDepth + 1 : 0;

    for (const [nodeId, node] of childTree.nodes) {
      const prefId = prefixNodeId(prefix, nodeId);
      const isRoot = nodeId === childTree.rootId;

      const adjustedNode: SemanticNode = {
        ...node,
        id: prefId,
        parentId: isRoot
          ? iframeNodeId // Root's parent is the iframe node
          : node.parentId
            ? prefixNodeId(prefix, node.parentId)
            : null,
        childIds: node.childIds.map((cid) => prefixNodeId(prefix, cid)),
        depth: node.depth + depthOffset,
        ui: { ...node.ui, expanded: node.depth + depthOffset < 3 },
      };

      mergedNodes.set(prefId, adjustedNode);
      nodeToFrame.set(prefId, childFrameId);
    }

    // Attach child frame root as child of iframe node
    if (iframeNodeId) {
      const iframeNode = mergedNodes.get(iframeNodeId);
      if (iframeNode) {
        const childRootPrefId = prefixNodeId(prefix, childTree.rootId);
        if (!iframeNode.childIds.includes(childRootPrefId)) {
          iframeNode.childIds = [...iframeNode.childIds, childRootPrefId];
        }
      }
    }
  }

  // Store the mapping for action routing
  state.nodeToFrame = nodeToFrame;

  // Send merged tree to side panel with page info
  const serialized = Array.from(mergedNodes.entries());
  chrome.runtime
    .sendMessage({
      type: "TREE_DATA",
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

// When the active tab changes, update tracking
chrome.tabs.onActivated.addListener((activeInfo) => {
  activeTabId = activeInfo.tabId;
});

// Route messages between frames, side panel, and content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // ---- Messages from content script frames ----
  if (sender.tab?.id) {
    const tabId = sender.tab.id;
    const frameId = sender.frameId ?? 0;
    activeTabId = tabId;

    switch (message.type) {
      case "FRAME_TREE_DATA": {
        // Store this frame's tree and schedule a merge
        const state = getTabState(tabId);
        const isNewTopFrame = frameId === 0 && !state.frames.has(0);
        state.frames.set(frameId, {
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
        // Prefix the nodeId and forward to side panel
        const prefixedNodeId = prefixNodeId(frameId, message.payload.nodeId);
        chrome.runtime
          .sendMessage({
            type: "FOCUS_CHANGED",
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

      case "LIVE_REGION": {
        // No-op: chrome.runtime.sendMessage from the content script
        // already delivers to the sidepanel directly.  Forwarding here
        // caused every announcement to appear twice.
        sendResponse({ received: true });
        return false;
      }

      default: {
        // Forward any other content script messages to side panel.
        chrome.runtime.sendMessage(message).catch((err) => {
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

  // Broadcast messages: send to ALL frames
  if (
    message.type === "REQUEST_TREE" ||
    message.type === "SET_VIEW_MODE" ||
    message.type === "SET_FOCUS_TRACKER"
  ) {
    if (activeTabId) {
      // Clear old frame data on fresh request
      if (message.type === "REQUEST_TREE") {
        const state = getTabState(activeTabId);
        state.frames.clear();
        state.nodeToFrame.clear();
      }
      chrome.tabs.sendMessage(activeTabId, message, () => {
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
            const state = getTabState(tabId);
            state.frames.clear();
            state.nodeToFrame.clear();
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
    state.frames.clear();
    state.nodeToFrame.clear();
  } else {
    // Subframe navigating — remove just this frame's data
    state.frames.delete(details.frameId);
    if (state.frames.size > 0) {
      scheduleMerge(details.tabId);
    }
  }
});

// Clean up on tab removal
chrome.tabs.onRemoved.addListener((tabId) => {
  const state = tabStates.get(tabId);
  if (state?.mergeTimer) clearTimeout(state.mergeTimer);
  tabStates.delete(tabId);
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
