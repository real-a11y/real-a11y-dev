/// <reference types="chrome" />

import {
  LiveTreeExtractor,
  ActionDispatcher,
  FocusManager,
  DomObserver,
  createPicker,
  getElementRefs,
  getExplicitRole,
  renderingParent,
  safeGetAttribute,
  safeNodeType,
  safeParentElement,
} from "@real-a11y-dev/core";
import type {
  SemanticNode,
  TreeViewMode,
  TreeChange,
} from "@real-a11y-dev/core";

import { computeFieldState } from "./field-state.js";
import {
  FRAME_HOLDER_SELECTOR,
  frameOwnerMark,
  isFrameHolder,
  markFrameOwner,
  newFrameMark,
  unmarkFrameOwner,
} from "./frame-owner.js";
import {
  liveDocumentElement,
  liveDocumentURL,
  livePageKeyWalker,
  PageKeySnapshots,
} from "./native/page-keys.js";
import { pageText } from "./page-text.js";
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

/** The extractor over the document's root element, or null while the
 *  document has none: one a script emptied (`document.open()`) and hasn't
 *  written to yet. */
function getLiveExtractor(): LiveTreeExtractor | null {
  if (!liveExtractor && boundRoot) {
    liveExtractor = new LiveTreeExtractor(boundRoot, { mode: liveMode() });
  }
  return liveExtractor;
}

// This frame's mark on the element holding it (see frame-owner.ts), which is
// how both trees know which <iframe> this frame's document belongs under
// when its URL can't say: an `about:blank` or `srcdoc` frame, or one a
// script wrote into. None for the top frame.
const frameMark = isSubFrame ? newFrameMark() : null;

/** Leave this frame's mark, and answer with it: undefined for the top frame,
 *  and for a frame of another origin than its parent's, which can't reach
 *  the element. Left again with everything that reports it, over whatever
 *  an earlier document in the frame left behind. */
function ownFrameMark(): string | undefined {
  return frameMark !== null && markFrameOwner(window, frameMark)
    ? frameMark
    : undefined;
}
// At load, so the walk of the document around this frame finds it whichever
// of the two is asked first.
ownFrameMark();
// The focus tracker exists to inform the side panel of real-DOM focus changes.
// Starts OFF — the panel turns it on via SET_FOCUS_TRACKER when it connects,
// and the background turns it off when the panel disconnects. Without this
// gate, the focusin listener below would keep redrawing the highlight overlay
// on every tab keystroke, even with no panel to receive the updates.
let focusTrackerEnabled = false;
let curtainVisible = false; // whether the screen curtain is currently on

// Armed by ARM_NATIVE_OVERLAY (see its comment in types.ts) around one native
// reveal or preview. While armed it honours exactly one event of its `kind`,
// the one carrying `nonce`, and a reveal's arm drops exactly one `focusin`,
// the one the reveal's focus causes. The service worker releases it once the
// dispatch returns (`seq` must match, so a late release from an older
// dispatch can't disarm a newer one); the deadline only bounds a release that
// never comes.
let nativeOverlayArm: {
  seq: number;
  until: number;
  kind: "reveal" | "preview";
  /** The one reveal event to honour; cleared once it is. */
  nonce: string | null;
  /** Whether the `focusin` the reveal causes has been dropped yet. */
  focusDropped: boolean;
} | null = null;
const NATIVE_OVERLAY_ARM_MS = 800;
const elementRefs = getElementRefs();
const dispatcher = new ActionDispatcher(elementRefs);
const focusManager = new FocusManager(elementRefs);
// The native reads' numberings of this frame's document, which focus is
// reported by for the native tree: see native/page-keys.ts. Every frame
// numbers its own. `chrome.dom.openOrClosedShadowRoot` is how the walk sees
// a closed shadow root, as the read's CDP walk does. The walk also reports
// the frames inside this document that marked their <iframe>.
const pageKeys = new PageKeySnapshots(
  livePageKeyWalker(
    chrome.dom?.openOrClosedShadowRoot
      ? (el) => chrome.dom.openOrClosedShadowRoot(el)
      : undefined,
  ),
  renderingParent,
  frameOwnerMark,
);
let liveObserver: MutationObserver | null = null;
// Whether live tree observation is armed. Starts OFF — deferred until the
// side panel connects for this tab, so a page whose panel is never opened
// does no extraction at all.
let observingEnabled = false;

/** Check if an element can receive focus */
function isFocusable(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if ((el as HTMLInputElement).disabled) return false;
  if (el.hasAttribute("tabindex")) return true;
  // The rule core's tab sequence follows: an editing host takes focus on its
  // own, and a link inside editable content can't be focused at all. This
  // script only runs in Chrome, so `isContentEditable` is the browser's own
  // answer, inherited editability included. The parent is read clobber-safely:
  // a `<form>`'s control named `parentElement` inherits the form's
  // editability, so an editable form would never count as the host.
  const parent = safeParentElement(el) as HTMLElement | null;
  if (el.isContentEditable && !parent?.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "A" || tag === "AREA") {
    return el.hasAttribute("href") && !el.isContentEditable;
  }
  if (["BUTTON", "INPUT", "SELECT", "TEXTAREA"].includes(tag)) return true;
  if (tag === "DETAILS" || tag === "SUMMARY") return true;
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
  observer?.stop();
  unobserveLiveRegions();
  documentObserver.disconnect();
  // Drop the picker listeners and restore the cursor so the page stops
  // showing crosshair after the extension is reloaded / orphaned.
  picker.teardown();
}

/** Extract tree and send to background as per-frame data */
function sendTree(change?: TreeChange) {
  const extractor = getLiveExtractor();
  // No root element to read: the next one to appear sends the tree.
  if (!extractor) return;
  const mode = liveMode();
  if (extractor.mode !== mode) {
    extractor.setMode(mode);
  }

  const result = change ? extractor.refresh(change) : extractor.extract();

  const serialized = Array.from(result.nodes.entries());
  const owner = ownFrameMark();
  const embeds = markedFrames(serialized);

  safeSendMessage({
    type: "FRAME_TREE_DATA",
    payload: {
      frameUrl: location.href,
      pageTitle: document.title,
      nodes: serialized,
      rootId: result.rootId,
      ...(owner !== undefined ? { owner } : {}),
      ...(embeds.length > 0 ? { embeds } : {}),
    },
  });
}

// Through the prototype: a named <img> or <form> called `querySelectorAll`
// shadows the document's own.
const querySelectorAll = Document.prototype.querySelectorAll;

/**
 * The tree's nodes for elements that hold a frame whose script marked them,
 * each with the mark: where the service worker puts that frame's tree (see
 * frame-owner.ts). A marked element the tree has no node for, as the a11y
 * view has none for a hidden <iframe>, goes with an empty node id: the
 * frame has no place in this tree, and the service worker needn't ask this
 * document where it is. One inside a shadow root isn't found that way, and
 * is asked after once.
 */
function markedFrames(
  nodes: ReadonlyArray<[string, SemanticNode]>,
): Array<[nodeId: string, owner: string]> {
  const out: Array<[string, string]> = [];
  const inTree = new Set<string>();
  for (const [nodeId, node] of nodes) {
    const tagName = node.dom?.tagName;
    if (!tagName || !isFrameHolder(tagName.toLowerCase())) continue;
    const element = elementRefs.get(nodeId);
    const mark = element ? frameOwnerMark(element) : undefined;
    if (mark === undefined) continue;
    out.push([nodeId, mark]);
    inTree.add(mark);
  }
  for (const element of querySelectorAll.call(
    document,
    FRAME_HOLDER_SELECTOR,
  )) {
    const mark = frameOwnerMark(element);
    if (mark !== undefined && !inTree.has(mark)) out.push(["", mark]);
  }
  return out;
}

/** The document's root element the script is bound to: what the tree is
 *  read from and watched under. See `rebindDocument`. */
let boundRoot: Element | null = liveDocumentElement(document);

/** Set up DOM observer for live updates */
function observerOf(root: Element | null): DomObserver | null {
  return root ? new DomObserver(root, (change) => sendTree(change)) : null;
}
let observer = observerOf(boundRoot);
// Hears the root element change: see `rebindDocument`. The document's own
// children change only then (or when a comment or doctype beside the root
// does), so this costs nothing on a page that never replaces its document.
const documentObserver = new MutationObserver(() => rebindDocument());
documentObserver.observe(document, { childList: true });

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
        // Focus may sit inside a shadow root already, whose moves only that
        // root hears.
        if (focusTrackerEnabled) watchFocusRoots(deepActiveElement());
        sendResponse({ success: true });
        break;
      }

      case "NATIVE_PAGE_KEYS": {
        // A native read numbering the page: the service worker asks every
        // frame, and each numbers its own document. The digest goes back
        // for the read to compare the numbering with its own, with what it
        // finds this document among CDP's by: this frame's mark on its
        // <iframe> and those of the frames inside this document, and the
        // document's URL. The numbering stays here for the focus reports
        // below, which also need to hear moves inside the shadow root focus
        // is in now.
        const root = liveDocumentElement(document);
        const owner = ownFrameMark();
        sendResponse(
          root
            ? {
                ...pageKeys.take(message.payload.readId, root),
                url: liveDocumentURL(document),
                ...(owner !== undefined ? { owner } : {}),
              }
            : null,
        );
        if (root) watchFocusRoots(deepActiveElement());
        break;
      }

      case "ARM_NATIVE_OVERLAY": {
        const { seq, active, nonce, kind = "reveal" } = message.payload;
        if (active) {
          nativeOverlayArm = {
            seq,
            until: Date.now() + NATIVE_OVERLAY_ARM_MS,
            kind,
            nonce: nonce ?? null,
            focusDropped: false,
          };
        } else if (nativeOverlayArm?.seq === seq) {
          nativeOverlayArm = null;
        }
        // Answering at all tells the service worker a live listener is here
        // to draw the overlay.
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

        drawCurtain();
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
          resolveTabSequence: () => {
            const extractor = getLiveExtractor();
            return extractor
              ? elementsFromTabSequence(extractor.extract(), elementRefs)
              : [];
          },
        });
        sendResponse({ success: true });
        setTimeout(() => sendTree(), 200);
        break;
      }
    }

    return true;
  },
);

/** Put the curtain's element in the document, or take it out, as
 *  `curtainVisible` has it. Only the top frame renders it. */
function drawCurtain(): void {
  if (isSubFrame) return;
  let curtain = document.getElementById("__sn-curtain");
  if (curtainVisible && !curtain && boundRoot) {
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
    boundRoot.appendChild(curtain);
  } else if (!curtainVisible && curtain) {
    curtain.remove();
  }
}

// Reverse focus sync: page focus → tree selection. Added by
// `listenToDocument`, as every listener on the document or its window is.
const onDocumentFocusIn = (e: Event) => onFocusIn(e, true);

/**
 * Report a focus change to the panel. `atDocument` is false for one heard on
 * a shadow root (see `watchFocusRoots`), which never reached the document,
 * and `target` names where focus went when the event itself doesn't.
 */
function onFocusIn(
  e: Event,
  atDocument: boolean,
  target: Element | null = null,
): void {
  if (focusingFromTree) return;
  if (
    nativeOverlayArm &&
    nativeOverlayArm.kind === "reveal" &&
    !nativeOverlayArm.focusDropped
  ) {
    const live = Date.now() < nativeOverlayArm.until;
    nativeOverlayArm.focusDropped = true;
    if (live) return;
  }
  if (!focusTrackerEnabled) return;
  const focused = target ?? deepFocusTarget(e);
  watchFocusRoots(focused);
  if (curtainVisible) return;

  // The DOM tree follows the document's view of the event, the outermost
  // shadow host, as it always has. A move heard on a shadow root keeps that
  // host, so it has nothing new to follow there.
  const nodeId = atDocument
    ? findTrackedAncestor(e.target as Element | null)
    : null;
  // For the native tree, which may hold a row for the element itself. A
  // report that numbers nothing still says which frame focus is in, and the
  // panel takes that frame's row. In the top frame it says nothing at all.
  const chains = pageKeys.keysFor(focused);
  const keys =
    chains &&
    (isSubFrame || Object.values(chains).some((chain) => chain.length > 0))
      ? chains
      : undefined;
  if (!nodeId && !keys) return;
  if (nodeId) focusManager.highlightElement(nodeId);
  safeSendMessage({
    type: "FOCUS_CHANGED",
    payload: {
      ...(nodeId ? { nodeId } : {}),
      ...(keys ? { pageKeys: keys } : {}),
    },
  });
}

/** The element focus landed on. `e.target` is retargeted to the outermost
 *  shadow host, and `composedPath()[0]` reaches into open roots only. */
function deepFocusTarget(e: Event): Element | null {
  const first = e.composedPath()[0] ?? e.target;
  return focusedWithin(first instanceof Element ? first : null);
}

/** `el`'s author shadow root, open or closed — only
 *  `chrome.dom.openOrClosedShadowRoot` sees a closed one. */
function authorShadowRoot(el: Element): ShadowRoot | null {
  if (!(el instanceof HTMLElement)) return null;
  return chrome.dom?.openOrClosedShadowRoot
    ? chrome.dom.openOrClosedShadowRoot(el)
    : openShadowRoot(el);
}

/** `el.shadowRoot`, read past a `<form>` control named `shadowRoot`. */
const shadowRootGetter = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "shadowRoot",
)?.get;
function openShadowRoot(el: Element): ShadowRoot | null {
  const root: unknown = shadowRootGetter ? shadowRootGetter.call(el) : null;
  return root instanceof ShadowRoot ? root : null;
}

/** `el`, or the element focused inside its shadow root, and so on down. A
 *  closed root's own `activeElement` says which of its elements has focus,
 *  where nothing outside it can. */
function focusedWithin(el: Element | null): Element | null {
  for (let depth = 0; el && depth < 32; depth++) {
    const inner = authorShadowRoot(el)?.activeElement;
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** The node at the root of `node`'s tree: a shadow root, or the document. */
const rootNodeOf = (node: Node): Node => Node.prototype.getRootNode.call(node);

/**
 * Focus that moves inside one shadow root never reaches the document: past
 * the root, the element losing focus and the one gaining it both retarget to
 * the host, and the event stops there. That covers a move between two of the
 * root's elements, and one between them and the host itself, which a
 * component with a focusable host (a list box moving focus to its options)
 * makes all the time. So each shadow root focus is seen inside, or on whose
 * host it lands, gets listeners of its own, for those moves alone. Focus
 * from outside a root, or to an element slotted into its host, which is
 * outside it too, reaches the next root out, or the document, and is
 * reported there.
 */
const watchedFocusRoots = new WeakSet<ShadowRoot>();
function watchFocusRoots(el: Element | null): void {
  if (!el) return;
  const own = authorShadowRoot(el);
  if (own) watchFocusRoot(own);
  for (
    let root = rootNodeOf(el);
    root instanceof ShadowRoot;
    root = rootNodeOf(root.host)
  ) {
    watchFocusRoot(root);
  }
}

function watchFocusRoot(root: ShadowRoot): void {
  if (watchedFocusRoots.has(root)) return;
  watchedFocusRoots.add(root);
  // Seen from inside the root, an element outside it reads as the host when
  // the root is in its path, and as itself otherwise.
  const inside = (node: EventTarget | null) =>
    node instanceof Node && rootNodeOf(node) === root;
  root.addEventListener("focusin", (e) => {
    const from = (e as FocusEvent).relatedTarget;
    if (inside(e.target) && (inside(from) || from === root.host)) {
      onFocusIn(e, false);
    }
  });
  // Back to the host from inside the root: no `focusin` goes anywhere, since
  // the host is both where focus went and, seen from outside, where it was.
  root.addEventListener("focusout", (e) => {
    if ((e as FocusEvent).relatedTarget === root.host) {
      onFocusIn(e, false, root.host);
    }
  });
}

/** Where focus is now, inside shadow roots too. Read clobber-safely: a named
 *  `<img>` or `<form>` called `activeElement` shadows the document's own. */
function deepActiveElement(): Element | null {
  const get = Object.getOwnPropertyDescriptor(
    Document.prototype,
    "activeElement",
  )?.get;
  const active: unknown = get ? get.call(document) : document.activeElement;
  return focusedWithin(active instanceof Element ? active : null);
}

/** The nearest element at or above `el` that the tree tracks, climbing out of
 *  shadow roots. Clobber-safe (`renderingParent`): through a `<form>` whose
 *  control is named `parentElement` or `getRootNode`, plain reads cycle or
 *  throw. */
function findTrackedAncestor(el: Element | null): string | null {
  for (; el; el = renderingParent(el)) {
    const nodeId = elementRefs.findId(el);
    if (nodeId) return nodeId;
  }
  return null;
}

// The native tree's selection follow asks for the same overlay the DOM tree's
// own select draws (HIGHLIGHT_NODE → `highlightElement`, scrolled into view),
// and its hover for the one the DOM tree's hover draws (in place: no scroll).
// `pageReveal` and `pagePreview` in native/native-core.ts fire these at the
// element from the page's main world, and DOM events reach this isolated
// world with the same target, so the overlay lands on the element the native
// row describes.
//
// The page can dispatch these events too, so each is honoured only while a
// native overlay of its own kind has armed us, only once, and only with the
// arm's nonce, which the page function receives as an argument and the page
// never sees ahead of time. A preview's arm can never draw a reveal, so no
// hover can scroll the page. The events don't bubble, so page listeners below
// `document` never see them; these listeners catch them on the way down. A
// page listener that captures one even earlier, on `window`, sees the nonce:
// it can stop the event, or replay that nonce on another element while the
// arm lasts and put the outline there. That is accepted: the page can draw a
// lookalike outline of its own anyway, and the arm still lets it draw nothing
// more than one overlay, nor scroll or focus anything the extension didn't.
function highlightFromNativeEvent(e: Event, kind: "reveal" | "preview"): void {
  const arm = nativeOverlayArm;
  if (!arm || arm.kind !== kind || Date.now() >= arm.until) return;
  if (arm.nonce === null || (e as CustomEvent).detail !== arm.nonce) return;
  arm.nonce = null;
  if (curtainVisible) return;
  // `composedPath()[0]` is the real target even inside an open shadow tree,
  // where `e.target` has been retargeted to the host.
  const nodeId = findTrackedAncestor(
    (e.composedPath()[0] ?? e.target) as Element | null,
  );
  if (nodeId) {
    focusManager.highlightElement(nodeId, { scroll: kind === "reveal" });
  }
}
const onNativeReveal = (e: Event) => highlightFromNativeEvent(e, "reveal");
const onNativePreview = (e: Event) => highlightFromNativeEvent(e, "preview");

// ---- Live region observer (top frame only) ----

/**
 * Attributes that can show or hide a region's content, or make an element a
 * region at all. Revealing a pre-filled `role="alert"` is an attribute change
 * and nothing else, and Chromium announces it.
 */
const LIVE_REGION_ATTRIBUTES = [
  "hidden",
  "inert",
  "class",
  "style",
  "aria-hidden",
  "open",
  "role",
  "aria-live",
];

if (!isSubFrame) {
  // Through the prototype: a `<form>` whose control is named `isConnected`
  // shadows its own. Core's readers cover the rest. A selector engine is no
  // help: `closest` in jsdom climbs through a form's shadowed `parentElement`.
  const isConnected = Object.getOwnPropertyDescriptor(
    Node.prototype,
    "isConnected",
  )!.get!;
  const createTreeWalker = Document.prototype.createTreeWalker;

  /**
   * How `element` announces, or null if it is no live region. Core's rule
   * (`countsAsOverlay`), with the role from core's own parse: an `aria-live`
   * of `polite` or `assertive` decides, `off` means none whatever the role, and
   * any other value — `<div aria-live>` included — leaves it to the role,
   * `alert` assertive and `status` or `log` polite.
   */
  const liveLevel = (element: Element): "polite" | "assertive" | null => {
    const live = safeGetAttribute(element, "aria-live")?.trim().toLowerCase();
    if (live === "polite" || live === "assertive") return live;
    if (live === "off") return null;
    const role = getExplicitRole(element);
    if (role === "alert") return "assertive";
    return role === "status" || role === "log" ? "polite" : null;
  };

  let liveDebounce: ReturnType<typeof setTimeout> | null = null;
  const lastLiveText = new WeakMap<Element, string>();
  // The regions a mutation touched since the last read. Only these are read
  // again: a region nothing changed in has nothing new to announce, and
  // reading every region on the page each time costs a styled walk of each.
  const touched = new Set<Element>();
  // Elements whose attributes changed. Each may have shown or hidden regions
  // inside it, so each is walked, once per read rather than once per change:
  // a page can restyle the same container every frame.
  const restyled = new Set<Element>();

  /** Mark every region that renders `node`, and with `inside`, every region
   *  in its subtree too. */
  const touch = (node: Node, inside: boolean) => {
    let element: Element | null;
    if (safeNodeType(node) === Node.ELEMENT_NODE) element = node as Element;
    else {
      // Text a slot renders belongs to the region around the slot.
      // eslint-disable-next-line no-restricted-properties -- one read, and a text node is never a form
      const slot = (node as Partial<Text>).assignedSlot;
      element = slot ?? safeParentElement(node);
    }
    // Up the tree that renders it, slots included, into a shadow tree's region.
    for (let el = element; el; el = renderingParent(el)) {
      if (liveLevel(el)) touched.add(el);
    }
    if (inside && element && element === node) {
      const walker = createTreeWalker.call(
        document,
        element,
        NodeFilter.SHOW_ELEMENT,
      );
      while (walker.nextNode()) {
        const el = walker.currentNode as Element;
        if (liveLevel(el)) touched.add(el);
      }
    }
  };

  liveObserver = new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === "attributes") {
        restyled.add(record.target as Element);
        continue;
      }
      touch(record.target, false);
      record.addedNodes.forEach((node) => touch(node, true));
    }
    if (liveDebounce) clearTimeout(liveDebounce);
    liveDebounce = setTimeout(() => {
      for (const element of restyled) {
        if (isConnected.call(element)) touch(element, true);
      }
      restyled.clear();
      const regions = [...touched];
      touched.clear();
      for (const region of regions) {
        if (!isConnected.call(region)) continue;
        const level = liveLevel(region);
        if (!level) continue;
        // What a screen reader could announce, never raw `textContent`: that
        // also holds a <textarea>'s markup default — the secret, for a
        // sensitive field — and hidden, script and style text, none of which
        // belongs on the message channel.
        const text = pageText(region, { announced: true }).trim();
        // Emptied or hidden: the same text shown again is news again.
        if (!text) {
          lastLiveText.delete(region);
          continue;
        }
        if (text === lastLiveText.get(region)) continue;
        lastLiveText.set(region, text);

        safeSendMessage({
          type: "LIVE_REGION",
          payload: { text, level, role: getExplicitRole(region) ?? "status" },
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
  observer?.start();
  observeLiveRegions();
  // Emit the current tree the moment we arm. On panel open the panel also
  // drives this via REQUEST_TREE, but a bfcache restore re-arms us through
  // FRAME_HELLO -> SET_OBSERVING(true) with no REQUEST_TREE and no mutation to
  // follow. Without this the panel would keep rendering the page we navigated
  // away from — and dispatch clicks to the wrong elements on the restored page
  // (node ids are a per-frame counter, so the ids collide). The 200ms merge
  // debounce in the background collapses this with any duplicate send.
  sendTree();
}

// Through the prototype: a named <img> or <form> called `body` shadows the
// document's own.
const bodyGetter = Object.getOwnPropertyDescriptor(
  Document.prototype,
  "body",
)?.get;
function documentBody(): Element | null {
  const body: unknown = bodyGetter ? bodyGetter.call(document) : document.body;
  return body instanceof Element ? body : null;
}

/** The body the live-region observer watches now. */
let liveBody: Element | null = null;
/** Hears the root element's own children change, for a body that comes
 *  after it or takes another's place. */
let bodyObserver: MutationObserver | null = null;

/**
 * Watch the document's body for live regions (top frame only), and the root
 * element for another body. A document written in stages has a root before
 * it has a body, and nothing else says when the body arrives: the root is
 * the same element, so `rebindDocument` has nothing to do.
 */
function observeLiveRegions() {
  if (!liveObserver) return;
  unobserveLiveRegions();
  if (boundRoot) {
    bodyObserver = new MutationObserver(() => {
      if (documentBody() !== liveBody) observeLiveRegions();
    });
    bodyObserver.observe(boundRoot, { childList: true });
  }
  liveBody = documentBody();
  if (!liveBody) return;
  liveObserver.observe(liveBody, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: LIVE_REGION_ATTRIBUTES,
  });
}

function unobserveLiveRegions() {
  liveObserver?.disconnect();
  bodyObserver?.disconnect();
  bodyObserver = null;
  liveBody = null;
}

/** Disarm observation when the panel disconnects. Idempotent. */
function stopObserving() {
  if (!observingEnabled) return;
  observingEnabled = false;
  observer?.stop();
  unobserveLiveRegions();
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

// ---- A document replaced under the script ----
//
// `document.open()` empties a document and builds another in its place, and
// a script can swap the root element itself. Neither navigates the frame, so
// no new script is injected and this one lives on, with nothing left of what
// it hung on the old document: the root element the tree is read from and
// watched under is detached, and `document.open()` also removes every
// listener from the document and its window. A blank frame a page writes
// into goes through exactly this, as often as not after this script has
// loaded in it. So whenever the document's root element changes, the script
// binds to the document again.

/** A document leaving its frame takes its mark off the <iframe>: the next
 *  one may be of another origin, and unable to put its own over it. Not one
 *  going into the back/forward cache, which is still the frame's. */
const onPageHide = (e: Event) => {
  if (frameMark !== null && !(e as PageTransitionEvent).persisted) {
    unmarkFrameOwner(window, frameMark);
  }
};

/** Add the listeners on the document and its window. Adding one that is
 *  already there does nothing, so this runs again as it is when only the
 *  root element was swapped and no listener was lost. */
function listenToDocument(): void {
  document.addEventListener("focusin", onDocumentFocusIn);
  document.addEventListener("real-a11y:native-reveal", onNativeReveal, true);
  document.addEventListener("real-a11y:native-preview", onNativePreview, true);
  window.addEventListener("popstate", onNavigated);
  window.addEventListener("hashchange", onNavigated);
  window.addEventListener("pageshow", onPageShow);
  window.addEventListener("pagehide", onPageHide);
}

function rebindDocument(): void {
  if (tornDown) return;
  const root = liveDocumentElement(document);
  if (root === boundRoot) return;
  boundRoot = root;
  listenToDocument();
  // The tree is read from the new root, and watched under it.
  liveExtractor = null;
  observer?.stop();
  observer = observerOf(root);
  unobserveLiveRegions();
  // An armed picker lost its listeners with the rest: arm it again, which
  // tells the panel nothing it doesn't know.
  if (picker.isEnabled()) {
    picker.teardown();
    picker.setEnabled(true);
  }
  // The curtain was an element of the document that is gone.
  drawCurtain();
  if (!observingEnabled) return;
  observer?.start();
  observeLiveRegions();
  sendTree();
}

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
const onPageShow = (e: Event) => {
  if ((e as PageTransitionEvent).persisted) onNavigated();
};

listenToDocument();
