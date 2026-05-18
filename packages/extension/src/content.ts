/// <reference types="chrome" />

import {
  extractDomTree,
  extractA11yTree,
  ActionDispatcher,
  FocusManager,
  DomObserver,
  getElementRefs,
} from "@real-a11y-dev/core";
import type { TreeViewMode } from "@real-a11y-dev/core";

import { createPicker } from "./picker.js";
import type { PanelToContent } from "./types.js";

const isSubFrame = window !== window.top;

let currentViewMode: TreeViewMode = "a11y";
let focusingFromTree = false;
// The focus tracker exists to inform the side panel of real-DOM focus changes.
// Starts OFF — the panel turns it on via SET_FOCUS_TRACKER when it connects,
// and the background turns it off when the panel disconnects. Without this
// gate, the focusin listener below would keep redrawing the highlight overlay
// on every tab keystroke, even with no panel to receive the updates.
let focusTrackerEnabled = false;
let curtainVisible = false; // whether the screen curtain is currently on
const elementRefs = getElementRefs();
const dispatcher = new ActionDispatcher(elementRefs);
const focusManager = new FocusManager(elementRefs);
let liveObserver: MutationObserver | null = null;

/** Check if an element can receive focus */
function isFocusable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if ((el as HTMLInputElement).disabled) return false;
  const tag = el.tagName;
  if (tag === "A" || tag === "AREA") return el.hasAttribute("href");
  if (["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(tag)) return true;
  if (tag === "DETAILS" || tag === "SUMMARY") return true;
  if (el.hasAttribute("tabindex")) return true;
  if (el.getAttribute("contenteditable") === "true") return true;
  return false;
}

/**
 * Send a message to the background, surviving the "orphaned content script"
 * case where the extension was reloaded/updated while this page was still
 * open. After invalidation, `chrome.runtime.id` is undefined and any
 * sendMessage call throws synchronously. We detect that, tear down our
 * observers once, and silently no-op subsequent sends — otherwise every
 * DOM mutation on the page keeps throwing forever.
 */
function safeSendMessage(message: unknown): void {
  try {
    if (!chrome.runtime?.id) {
      teardown();
      return;
    }
    chrome.runtime.sendMessage(message);
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.includes("Extension context invalidated")
    ) {
      teardown();
      return;
    }
    throw err;
  }
}

let tornDown = false;
function teardown(): void {
  if (tornDown) return;
  tornDown = true;
  observer.stop();
  liveObserver?.disconnect();
  // Drop the picker listeners and restore the cursor so the page stops
  // showing crosshair after the extension is reloaded / orphaned.
  picker.teardown();
}

/** Extract tree and send to background as per-frame data */
function sendTree() {
  const result =
    currentViewMode === "dom"
      ? extractDomTree(document.documentElement)
      : extractA11yTree(document.documentElement);

  const serialized = Array.from(result.nodes.entries());

  safeSendMessage({
    type: "FRAME_TREE_DATA",
    payload: {
      frameUrl: location.href,
      pageTitle: document.title,
      nodes: serialized,
      rootId: result.rootId,
    },
  });
}

/** Set up DOM observer for live updates */
const observer = new DomObserver(document.documentElement, () => {
  sendTree();
});

// ─── Element picker (DevTools-style "select an element in the page") ─────────
//
// All behavior lives in the standalone `createPicker` factory in
// ./picker.ts — that module is unit-tested in jsdom without chrome.runtime.
// The wiring here just injects the runtime dependencies (FocusManager
// highlight, the shared elementRefs, safeSendMessage for panel
// notifications) and keeps a reference for teardown.
const picker = createPicker({
  doc: document,
  isSubFrame,
  findId: (el) => elementRefs.findId(el),
  onHighlight: (nodeId) =>
    focusManager.highlightElement(nodeId, { scroll: false }),
  onClearHighlight: () => focusManager.clearHighlight(),
  onPicked: (nodeId) =>
    safeSendMessage({ type: "NODE_PICKED", payload: { nodeId } }),
  onModeChange: (enabled) =>
    safeSendMessage({ type: "PICK_MODE_CHANGED", payload: { enabled } }),
});

// Listen for messages from side panel (via background)
chrome.runtime.onMessage.addListener(
  (message: PanelToContent, _sender, sendResponse) => {
    switch (message.type) {
      case "REQUEST_TREE": {
        currentViewMode = message.payload.viewMode;
        sendTree();
        sendResponse({ success: true });
        break;
      }

      case "SET_VIEW_MODE": {
        currentViewMode = message.payload.viewMode;
        sendTree();
        sendResponse({ success: true });
        break;
      }

      case "DISPATCH_ACTION": {
        const result = dispatcher.dispatch(message.payload);
        sendResponse(result);

        // Re-extract tree after interaction (page may have changed)
        setTimeout(() => sendTree(), 100);
        break;
      }

      case "HIGHLIGHT_NODE": {
        const nodeId = message.payload.nodeId;

        // Skip visual indicator and focus() when the curtain is on —
        // the page is hidden so there's nothing to highlight, and calling
        // focus() would trigger native browser focus rings on a covered page.
        if (!curtainVisible) {
          focusManager.highlightElement(nodeId);

          const element = elementRefs.get(nodeId);
          if (element && isFocusable(element)) {
            focusingFromTree = true;
            // preventScroll: highlightElement() above already centered the
            // element. Letting .focus() trigger its own "nearest" scroll on
            // top would re-snap the element to a viewport edge.
            (element as HTMLElement).focus({ preventScroll: true });
            focusingFromTree = false;
          }
        }

        sendResponse({ success: true });
        break;
      }

      case "CLEAR_HIGHLIGHT": {
        focusManager.clearHighlight();
        sendResponse({ success: true });
        break;
      }

      case "SET_FOCUS_TRACKER": {
        focusTrackerEnabled = message.payload.enabled;
        sendResponse({ success: true });
        break;
      }

      case "SET_PICK_MODE": {
        picker.setEnabled(message.payload.enabled);
        sendResponse({ success: true });
        break;
      }

      case "TOGGLE_CURTAIN": {
        curtainVisible = message.payload.visible;

        // Clear any lingering highlight overlay when the curtain turns on
        if (curtainVisible) {
          focusManager.clearHighlight();
        }

        // Only the top frame renders the curtain DOM element
        if (isSubFrame) {
          sendResponse({ success: true });
          break;
        }
        const show = message.payload.visible;
        let curtain = document.getElementById("__sn-curtain");
        if (show && !curtain) {
          curtain = document.createElement("div");
          curtain.id = "__sn-curtain";
          curtain.style.cssText = `
            position: fixed; inset: 0; z-index: 2147483646;
            background: #0f172a; color: #94a3b8;
            display: flex; align-items: center; justify-content: center;
            flex-direction: column; gap: 8px;
            font: 16px/1.5 system-ui, sans-serif;
          `;
          curtain.innerHTML = `
            <div style="font-size:24px;font-weight:700;color:#e2e8f0">Screen Curtain</div>
            <div>Content hidden — navigate via Semantic Navigator</div>
          `;
          document.documentElement.appendChild(curtain);
        } else if (!show && curtain) {
          curtain.remove();
        }
        sendResponse({ success: true });
        break;
      }

      case "GET_FIELD_STATE": {
        const el = elementRefs.get(message.payload.nodeId);
        if (!el) {
          sendResponse({ success: false });
          break;
        }
        const tag = el.tagName.toLowerCase();

        if (tag === "select") {
          const select = el as HTMLSelectElement;
          const options = Array.from(select.options).map((opt) => ({
            value: opt.value,
            label: opt.textContent?.trim() || opt.value,
            selected: opt.selected,
          }));
          sendResponse({
            success: true,
            type: "select",
            value: select.value,
            options,
          });
        } else if (tag === "input" || tag === "textarea") {
          const input = el as HTMLInputElement;
          sendResponse({
            success: true,
            type: input.type || "text",
            value: input.value,
            placeholder: input.placeholder || "",
          });
        } else {
          sendResponse({ success: false });
        }
        break;
      }

      case "SEND_KEY": {
        const p = message.payload;
        const target = document.activeElement || document.body;
        target.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: p.key,
            code: p.code,
            keyCode: p.keyCode,
            bubbles: true,
            cancelable: true,
            shiftKey: !!p.modifiers?.shift,
            ctrlKey: !!p.modifiers?.ctrl,
            altKey: !!p.modifiers?.alt,
            metaKey: !!p.modifiers?.meta,
          } as KeyboardEventInit),
        );
        target.dispatchEvent(
          new KeyboardEvent("keyup", {
            key: p.key,
            code: p.code,
            keyCode: p.keyCode,
            bubbles: true,
            cancelable: true,
            shiftKey: !!p.modifiers?.shift,
            ctrlKey: !!p.modifiers?.ctrl,
            altKey: !!p.modifiers?.alt,
            metaKey: !!p.modifiers?.meta,
          } as KeyboardEventInit),
        );
        sendResponse({ success: true });
        setTimeout(() => sendTree(), 200);
        break;
      }
    }

    return true;
  },
);

// Reverse focus sync: page focus → tree selection
document.addEventListener("focusin", (e) => {
  if (focusingFromTree) return;
  if (!focusTrackerEnabled) return;
  if (curtainVisible) return;

  // Walk up from focused element to find a tracked node
  let el = e.target as Element | null;
  while (el) {
    const nodeId = elementRefs.findId(el);
    if (nodeId) {
      focusManager.highlightElement(nodeId);
      safeSendMessage({
        type: "FOCUS_CHANGED",
        payload: { nodeId },
      });
      return;
    }
    el = el.parentElement;
  }
});

// ---- Live region observer (top frame only) ----
if (!isSubFrame) {
  let liveDebounce: ReturnType<typeof setTimeout> | null = null;
  const lastLiveText = new WeakMap<Element, string>();

  liveObserver = new MutationObserver(() => {
    if (liveDebounce) clearTimeout(liveDebounce);
    liveDebounce = setTimeout(() => {
      const regions = document.querySelectorAll(
        '[role="status"], [role="alert"], [role="log"], [aria-live]',
      );
      for (const region of regions) {
        const text = (region.textContent || "").trim();
        if (!text || text === lastLiveText.get(region)) continue;
        lastLiveText.set(region, text);

        const role = region.getAttribute("role") || "status";
        const ariaLive = region.getAttribute("aria-live");
        const level =
          ariaLive === "assertive" || role === "alert" ? "assertive" : "polite";

        safeSendMessage({
          type: "LIVE_REGION",
          payload: { text, level, role },
        });
      }
    }, 200);
  });

  liveObserver.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
}

// Start observing
observer.start();

// Send initial tree
sendTree();

// Re-send tree on navigation
window.addEventListener("popstate", () => sendTree());
window.addEventListener("hashchange", () => sendTree());
