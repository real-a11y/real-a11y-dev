/// <reference types="chrome" />

import {
  LiveTreeExtractor,
  ActionDispatcher,
  FocusManager,
  DomObserver,
  createPicker,
  getElementRefs,
} from "@real-a11y-dev/core";
import type { TreeViewMode, TreeChange } from "@real-a11y-dev/core";

import { computeFieldState } from "./field-state.js";
import { isTrustedSender, planHighlight } from "./routing.js";
import { elementsFromTabSequence, sendKey } from "./send-key.js";
import type { PanelToContent } from "./types.js";

const isSubFrame = window !== window.top;

/**
 * Actions whose dispatch goes through `ActionDispatcher`'s synthetic
 * pointerdown→click sequence, and which an armed element picker therefore
 * swallows.
 *
 * Not `toggle`, despite its click fallback: the extractor emits it only for
 * `<details>`/`<summary>` (`dom-extractor.ts`), and both of those flip
 * `.open` directly, so the fallback is unreachable from a tree this panel
 * built. The rest — `type`, `select`, `focus`, `submit`, `scroll` and the
 * steppers, which use Arrow keys — never touch a pointer event either.
 */
const POINTER_ACTIONS = new Set(["click", "navigate"]);

let currentViewMode: TreeViewMode = "a11y";
let focusingFromTree = false;
let liveExtractor: LiveTreeExtractor | null = null;

function liveMode(): "dom" | "a11y" {
  return currentViewMode === "dom" ? "dom" : "a11y";
}

function getLiveExtractor(): LiveTreeExtractor {
  if (!liveExtractor) {
    liveExtractor = new LiveTreeExtractor(document.documentElement, {
      mode: liveMode(),
    });
  }
  return liveExtractor;
}
// The focus tracker exists to inform the side panel of real-DOM focus changes.
// Starts OFF — the panel turns it on via SET_FOCUS_TRACKER when it connects,
// and the background turns it off when the panel disconnects. Without this
// gate, the focusin listener below would keep redrawing the highlight overlay
// on every tab keystroke, even with no panel to receive the updates.
let focusTrackerEnabled = false;
let curtainVisible = false; // whether the screen curtain is currently on

// Armed by SUPPRESS_NATIVE_FOCUS_TRACK (see its comment in types.ts): drops
// exactly ONE focusin — the one the native dispatch causes — then disarms.
// The panel releases it explicitly once the dispatch returns (`seq` must
// match, so a late release from an older dispatch can't disarm a newer one),
// and the deadline only bounds the case where that release never arrives.
// Without the one-shot and the release, every genuine user focus change for
// the whole window would be swallowed too.
let nativeFocusSuppress: { seq: number; until: number } | null = null;
const NATIVE_FOCUS_SUPPRESS_MS = 800;
const elementRefs = getElementRefs();
const dispatcher = new ActionDispatcher(elementRefs);
const focusManager = new FocusManager(elementRefs);
let liveObserver: MutationObserver | null = null;
// Whether live tree observation is armed. Starts OFF — deferred until the
// side panel connects for this tab, so a page whose panel is never opened
// does no extraction at all.
let observingEnabled = false;

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
function sendTree(change?: TreeChange) {
  const extractor = getLiveExtractor();
  const mode = liveMode();
  if (extractor.mode !== mode) {
    extractor.setMode(mode);
  }

  const result = change ? extractor.refresh(change) : extractor.extract();

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
const observer = new DomObserver(document.documentElement, (change) => {
  sendTree(change);
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
  (message: PanelToContent, sender, sendResponse) => {
    // Only honor commands from our own extension's background (which relays
    // the side panel's actions — the panel never messages this frame
    // directly). onMessage is same-extension only, so this never fires in
    // practice, but these handlers dispatch clicks + keystrokes and read
    // live field state, so assert the trust boundary explicitly rather than
    // acting on whatever reaches the listener. Returning false closes the
    // channel with no response for a rejected sender.
    if (!isTrustedSender(sender, chrome.runtime.id)) return false;

    switch (message.type) {
      case "REQUEST_TREE": {
        currentViewMode = message.payload.viewMode;
        // Requesting a tree implies the panel is open — arm live updates so
        // the panel keeps receiving them after this one-time populate.
        startObserving();
        sendTree();
        sendResponse({ success: true });
        break;
      }

      case "RESEND_TREE": {
        // The background's per-tab frame registry is memory-only, so a
        // service-worker restart empties it while this frame keeps observing
        // and stays silent until its own DOM next mutates. This is the
        // background asking us to re-announce so its merge sees us again.
        // Unlike REQUEST_TREE it carries no viewMode and must not change
        // ours — `currentViewMode` survived the restart and is still right.
        //
        // Only answer if already armed — which is the restart case, and the
        // only one the background sends this for. Arming here instead would
        // make this the one message that can start extraction in a frame the
        // background deliberately didn't arm (observation is panel-gated;
        // `planFrameHello` returns nothing when no panel is connected), and
        // the panel can drop between the send and its arrival.
        if (observingEnabled) sendTree();
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
        // An armed picker owns the page's POINTER events, so an action that
        // reaches the dispatcher's synthetic pointerdown→click sequence
        // cannot land: the picker's capture-phase listeners swallow the whole
        // sequence before the page sees any of it. Worse, that click reaches
        // the picker's own handler, which resolves the actioned element —
        // tracked by construction, since the action arrived as a node id —
        // reports it as a NODE_PICKED the user never pointed at, and drops
        // out of pick mode. Refuse instead: same page outcome as before,
        // without the phantom pick.
        //
        // Only the pointer actions. The picker listens for pointer events and
        // Escape, nothing else, so `type`, `select`, `focus`, `submit`,
        // `scroll` and the steppers (keyboard arrows) reach the page
        // unharmed and stay available — blocking those would strand a typed
        // value in the input panel for no reason. `toggle` is here because it
        // falls back to a click for anything that is not a <details>.
        if (picker.isEnabled() && POINTER_ACTIONS.has(message.payload.action)) {
          sendResponse({
            success: false,
            error: "Turn off pick mode to act on the page",
          });
          break;
        }

        const result = dispatcher.dispatch(message.payload);
        sendResponse(result);

        // Re-extract tree after interaction (page may have changed)
        setTimeout(() => sendTree(), 100);
        break;
      }

      case "HIGHLIGHT_NODE": {
        const { nodeId, hover } = message.payload;

        // Skip visual indicator and focus() when the curtain is on —
        // the page is hidden so there's nothing to highlight, and calling
        // focus() would trigger native browser focus rings on a covered page.
        if (!curtainVisible) {
          // Hover previews the element in place; only a selection may move the
          // viewport or real focus. See planHighlight for why.
          const { scroll, moveFocus } = planHighlight({ hover });
          focusManager.highlightElement(nodeId, { scroll });

          const element = elementRefs.get(nodeId);
          if (moveFocus && element && isFocusable(element)) {
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

      case "SUPPRESS_NATIVE_FOCUS_TRACK": {
        const { seq, active } = message.payload;
        if (active) {
          nativeFocusSuppress = {
            seq,
            until: Date.now() + NATIVE_FOCUS_SUPPRESS_MS,
          };
        } else if (nativeFocusSuppress?.seq === seq) {
          nativeFocusSuppress = null;
        }
        sendResponse({ success: true });
        break;
      }

      case "SET_OBSERVING": {
        if (message.payload.enabled) startObserving();
        else stopObserving();
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
        // Covers native <select>/<input>/<textarea> AND custom contenteditable
        // text widgets (ARIA textbox/combobox/searchbox — Slack, Notion, etc.).
        sendResponse(computeFieldState(el));
        break;
      }

      case "SEND_KEY": {
        // No pick-mode gate here, deliberately. The picker's keydown
        // listener acts on exactly one key — it takes Escape as "leave pick
        // mode" — and that is a reasonable thing for Escape to do, not the
        // silent corruption DISPATCH_ACTION suffered. Refusing it instead
        // would leave the key bar's Esc doing nothing at all: the page never
        // sees it either way, and the mode it used to close stays open.
        // Every other key passes the picker untouched.
        //
        // Synthetic KeyboardEvents are untrusted — Chrome skips their
        // default actions (Tab does not move focus; Escape does not close
        // <dialog>). sendKey dispatches the events for page listeners and
        // applies those defaults itself unless preventDefault ran. Tab
        // order reuses core getTabSequence via the live extractor — same
        // policy as the panel's Tab Sequence view.
        const target = document.activeElement || document.body;
        sendKey(target, message.payload, {
          resolveTabSequence: () =>
            elementsFromTabSequence(getLiveExtractor().extract(), elementRefs),
        });
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
  if (nativeFocusSuppress) {
    const live = Date.now() < nativeFocusSuppress.until;
    nativeFocusSuppress = null;
    if (live) return;
  }
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

// The native tree's selection follow asks for the same overlay the DOM
// tree's own select draws (HIGHLIGHT_NODE → `highlightElement`, scrolled into
// view). `pageReveal` in native/native-core.ts fires this from the page's
// main world; DOM events reach this isolated world with the same target, so
// the overlay lands on the exact element the native row describes. Honored
// only while a native follow has armed SUPPRESS_NATIVE_FOCUS_TRACK: the page
// can dispatch this event itself, and nothing unrequested may draw over or
// scroll it.
document.addEventListener("real-a11y:native-reveal", (e) => {
  if (!nativeFocusSuppress || Date.now() >= nativeFocusSuppress.until) return;
  if (curtainVisible) return;
  // `composedPath()[0]` is the real target even inside an open shadow tree,
  // where `e.target` has been retargeted to the host by the time it bubbles
  // up to `document`.
  let el = (e.composedPath()[0] ?? e.target) as Element | null;
  while (el) {
    const nodeId = elementRefs.findId(el);
    if (nodeId) {
      focusManager.highlightElement(nodeId);
      return;
    }
    const root = el.getRootNode();
    el = el.parentElement ?? (root instanceof ShadowRoot ? root.host : null);
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
}

/**
 * Arm live observation: start the core DomObserver and (top frame) the
 * live-region observer. Deferred until the panel connects — the background
 * sends SET_OBSERVING(true) / the panel sends REQUEST_TREE on open.
 * Idempotent.
 */
function startObserving() {
  if (observingEnabled) return;
  observingEnabled = true;
  observer.start();
  liveObserver?.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
  });
  // Emit the current tree the moment we arm. On panel open the panel also
  // drives this via REQUEST_TREE, but a bfcache restore re-arms us through
  // FRAME_HELLO -> SET_OBSERVING(true) with no REQUEST_TREE and no mutation to
  // follow. Without this the panel would keep rendering the page we navigated
  // away from — and dispatch clicks to the wrong elements on the restored page
  // (node ids are a per-frame counter, so the ids collide). The 200ms merge
  // debounce in the background collapses this with any duplicate send.
  sendTree();
}

/** Disarm observation when the panel disconnects. Idempotent. */
function stopObserving() {
  if (!observingEnabled) return;
  observingEnabled = false;
  observer.stop();
  liveObserver?.disconnect();
}

function onNavigated() {
  // Re-announce so a connected panel re-arms this frame after the
  // navigation; only re-extract if we're actively observing. The new URL
  // rides on that re-extraction's FRAME_TREE_DATA, not on the announce.
  safeSendMessage({ type: "FRAME_HELLO" });
  if (observingEnabled) sendTree();
}

// Announce presence WITHOUT extracting, and without saying anything about the
// page. The background replies with SET_OBSERVING(true) only if a side panel
// is connected for this tab, so a page whose panel is never opened pays
// nothing — and, since this announce is payload-free, tells the extension
// nothing. This is the only message an unarmed frame ever sends, and it runs
// in every frame of every page the user visits.
safeSendMessage({ type: "FRAME_HELLO" });

window.addEventListener("popstate", onNavigated);
window.addEventListener("hashchange", onNavigated);

// Back/forward-cache restore. When the user navigates A → B and presses Back,
// A is served from bfcache: no content-script re-injection, no mutations (so
// the DomObserver stays silent), and NO popstate for the cross-document
// traversal — only `pageshow` with `persisted === true`. Without this handler
// the panel keeps rendering page B's tree while the user is on A. That is not
// just stale: node ids are a per-frame counter (`sn-<n>`), so B's ids collide
// with A's still-live elements, and clicking a node in the stale tree
// dispatches an action on an unrelated element on A. Re-announce + re-send so
// the panel snaps back to the restored page.
//
// No `pagehide` teardown on the way into bfcache: the page is frozen there so
// the observer does no work. If we were still observing at freeze,
// `onNavigated` re-sends the tree immediately on restore; if the panel had
// been closed on this page (observingEnabled=false), the `FRAME_HELLO` above
// re-arms us when a panel is connected and `startObserving` emits the tree.
window.addEventListener("pageshow", (e) => {
  if (e.persisted) onNavigated();
});
