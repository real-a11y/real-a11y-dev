import type {
  SemanticNode,
  TreeViewMode,
  ActionRequest,
  ActionResult,
} from "@real-a11y-dev/core";

import type { NativeUnavailableReason } from "./native/capability.js";

/**
 * Where the page's focus went (Focus sync), for whichever tree the panel
 * shows. Either field may be missing, never both.
 */
export interface FocusChangedPayload {
  /** The DOM tree's node for the focused element, or the nearest one above
   *  it that the tree tracks. */
  nodeId?: string;
  /**
   * For the native tree: by native read, the numbers the read gave the
   * focused element and each numbered element above it in its document,
   * nearest first (see `native/page-keys.ts`). The panel takes the first that
   * names a row of the tree it got from that read.
   */
  pageKeys?: Record<string, number[]>;
  /** The frame whose document `pageKeys` number, as the extension knows it
   *  (0: the top frame). The service worker sets it, from the sender, on
   *  what it forwards to the panel. */
  frameId?: number;
}

/** Messages from content script frame → background (per-frame tree data) */
export type FrameToBackground =
  | {
      type: "FRAME_TREE_DATA";
      payload: {
        frameUrl: string;
        pageTitle: string;
        nodes: Array<[string, SemanticNode]>;
        rootId: string;
        /** The mark this frame's script left on the element holding the
         *  frame (see `frame-owner.ts`): which <iframe> its tree goes under.
         *  Absent for the top frame, and for a frame of another origin than
         *  its parent's. */
        owner?: string;
        /** This tree's nodes for elements holding a frame that marked them,
         *  each with the mark. An empty node id is a marked element the tree
         *  has no node for, such as a hidden `<iframe>` in the a11y view. */
        embeds?: Array<[nodeId: string, owner: string]>;
        /** The frame was read again on request (REQUEST_TREE, RESEND_TREE,
         *  SET_VIEW_MODE) or after an action or a key, not because it
         *  changed: what the action did, the frame's observer reports on
         *  its own. Not a page change for Chrome's tree to follow. */
        reread?: true;
        /** On a tree that isn't a re-read: when the frame last changed, in
         *  ms since the epoch. For a burst of changes its observer saw, when
         *  the burst ended, a debounce before the tree was read; for a tree
         *  sent unasked otherwise, such as the frame's first, when it was
         *  read. A burst the observer flushed at its ceiling, still going,
         *  can have changed up to that debounce later: its next flush says
         *  so. */
        changedAt?: number;
        /** The frame's skeleton, not its tree: see `frame-skeleton.ts`. */
        framesOnly?: true;
      };
    }
  // Cheap "I'm here" announce sent at content-script load, carrying no tree.
  // It lets the background learn a frame is reachable so it can tell the
  // frame to start observing IFF a panel is connected — without paying a
  // full extraction on every page whether or not the panel is ever opened.
  //
  // Deliberately payload-free. This is the ONE message every frame of every
  // page the user visits sends whether or not the extension is ever opened
  // there, so it must not carry anything about the page: the background
  // learns which frame is speaking from `sender.tab.id` / `sender.frameId`,
  // which is all `planFrameHello` takes. Page-derived data belongs on
  // FRAME_TREE_DATA, which is only ever sent by an armed frame.
  | { type: "FRAME_HELLO" }
  // The user clicked, or pressed Enter or Space, on the page, or typed
  // there (`page-input.ts`), sent only while the panel is open. They say
  // nothing more on purpose than when, by the frame's clock, as for
  // `changedAt`: never what or where. A click says when the user made it
  // (`at`), which a busy frame dispatches late; typing, when its edit was
  // made (`at`) and when the user pressed the key that made it
  // (`pressedAt`). Like LIVE_REGION they reach the panel straight from the
  // content script, scoped by `sender.tab.id`, and the service worker
  // doesn't relay them.
  | { type: "PAGE_INPUT"; at: number }
  | { type: "PAGE_TYPING"; at: number; pressedAt: number }
  | { type: "FOCUS_CHANGED"; payload: FocusChangedPayload }
  | {
      type: "LIVE_REGION";
      payload: { text: string; level: "polite" | "assertive"; role: string };
    };

/**
 * Messages from background → side panel (merged tree).
 *
 * The side panel filters by `tabId` to discard updates that aren't for the
 * tab it's currently bound to — without that, a background tab's content
 * script announcing itself broadcasts to every open side panel and a panel
 * pointed at tab A starts showing tab B's tree. `tabId` is optional only
 * because LIVE_REGION rides directly from content → panel and the side
 * panel can read `sender.tab.id` instead.
 */
export type ContentToPanel =
  | {
      type: "TREE_DATA";
      tabId?: number;
      payload: {
        nodes: Array<[string, SemanticNode]>;
        rootId: string;
        pageTitle: string;
        pageUrl: string;
        /** When the top frame, and each frame the page shows, last changed
         *  (their `changedAt`, in ms since the epoch, earliest first), for
         *  the changes no publish has answered for yet. Absent when there is
         *  none, or only a hidden frame's — see `TabState.changedFrames`. */
        pageChangedAt?: number[];
        /** A frame sent its skeleton (`FRAME_TREE_DATA.framesOnly`): the
         *  nodes say where the page's frames are, and are no tree to show. */
        framesOnly?: true;
      };
    }
  | {
      type: "TREE_UPDATED";
      tabId?: number;
      payload: { nodes: Array<[string, SemanticNode]>; rootId: string };
    }
  | { type: "ACTION_RESULT"; tabId?: number; payload: ActionResult }
  | { type: "NAVIGATION"; tabId?: number; payload: { url: string } }
  // Background → panel push: the tab's TOP frame is navigating, so whatever
  // tree the panel is holding describes a document that is on its way out.
  // Carries no replacement — the new page's content script announces one if
  // it can run at all, and if it can't, saying so is the panel's job.
  | { type: "PAGE_NAVIGATED"; tabId: number }
  | { type: "FOCUS_CHANGED"; tabId?: number; payload: FocusChangedPayload }
  | { type: "PAGE_INPUT"; at: number; tabId?: number }
  | { type: "PAGE_TYPING"; at: number; pressedAt: number; tabId?: number }
  | {
      type: "LIVE_REGION";
      tabId?: number;
      payload: { text: string; level: "polite" | "assertive"; role: string };
    }
  | {
      // Background → panel push: the tab window `windowId`'s side panel
      // shows has changed. Every panel hears it and only that window's
      // takes it (`isPanelWindow`), as its source of truth for myTabId,
      // because the background's `chrome.tabs.onActivated` listener is the
      // canonical writer. A popup window shows in the panel of the last
      // ordinary window the user was in (`panelWindowFor`), so `windowId` is
      // the panel's window, not always the tab's. `focus`: the window's own
      // tab, told because the user moved to the window, which a panel that
      // has focus itself leaves, since moving to it is what focused it.
      type: "ACTIVE_TAB_CHANGED";
      tabId: number;
      windowId: number;
      focus?: boolean;
    }
  | {
      // Background → panel push: tab `tabId` closed. A panel showing it
      // goes back to its own window's active tab.
      type: "TAB_CLOSED";
      tabId: number;
    }
  // Picker (DevTools-style "select an element in the page"): the user
  // clicked an element on the page while pick mode was on. Content
  // resolves the click target up the DOM tree to the nearest tracked
  // node and sends its id; panel selects it, scrolls it into view, and
  // turns pick mode back off.
  | { type: "NODE_PICKED"; tabId?: number; payload: { nodeId: string } }
  // Picker: content acknowledges that pick mode entered or exited (e.g.
  // the user pressed Escape on the page). Panel mirrors its toggle so
  // the UI doesn't drift out of sync.
  | {
      type: "PICK_MODE_CHANGED";
      tabId?: number;
      payload: { enabled: boolean };
    }
  // Native picker's counterpart to NODE_PICKED. Lives here (unlike the rest
  // of the NATIVE_* messages, which stay in native/index.ts's own
  // NativeMessage union — see that union's own comment) because it is a
  // genuine background→panel PUSH the same shape as NODE_PICKED/
  // PICK_MODE_CHANGED above, not a request/response call; the panel's
  // single message handler already routes exactly this shape.
  | {
      type: "NATIVE_PICK_RESULT";
      tabId: number;
      // Echoed straight back from this result's own NATIVE_PICK_START —
      // see that message's own comment for why the panel needs it to tell
      // a stale pick's delayed result apart from the one it's currently
      // showing armed.
      requestId: number;
      payload:
        | {
            nodeId: string;
            // Nearest-first fallback chain (nodeId's own DOM ancestors) for
            // when the hit-tested element itself was never kept in the AX
            // tree — an unnamed wrapper, padding inside a labelled group,
            // and so on. The panel tries these in order against whatever
            // tree it currently has loaded; see NativeTreeView's `reveal`
            // prop. Absent when the ancestor lookup itself failed (an older
            // Chromium, a torn-down target) — `nodeId` alone is still tried.
            ancestorIds?: string[];
          }
        // Escape, a STOP, or (with `timedOut`) the pick's time limit.
        | { cancelled: true; timedOut?: true }
        // A real attach/dispatch failure — DevTools already attached, the
        // tab navigated somewhere unattachable mid-arm, a connection drop —
        // distinct from a user-initiated cancel so the panel can surface it
        // instead of silently mirroring Escape's own quiet exit.
        | { error: string; reason?: NativeUnavailableReason };
    }
  // Inspect mode is on for this pick: a click on the page is now a pick, and
  // Escape on the page cancels it. Until this arrives the panel shows the
  // pick as arming.
  | { type: "NATIVE_PICK_ARMED"; tabId: number; requestId: number };

/** Select option for GET_FIELD_STATE response */
export interface SelectOption {
  value: string;
  label: string;
  selected: boolean;
  /** A disabled `<option>`: listed, but it can't be chosen. */
  disabled?: boolean;
}

/**
 * Optional tab the side panel is bound to. Panel→content commands stamp this
 * so the background prefers it over its global `activeTabId` (which races
 * `chrome.tabs.onActivated` after a tab switch).
 */
type BoundTab = { tabId?: number };

/**
 * The tree the panel asks a tab's frames for. `framesOnly`: each frame's
 * skeleton (`frame-skeleton.ts`) in place of its tree, while Chrome's tree
 * shows and no TAB view does. A frame starts so, and sends its whole tree once
 * asked for one: for the in-page tree, and for either tree's TAB view.
 */
export interface TreeRequest {
  viewMode: TreeViewMode;
  framesOnly?: boolean;
}

/**
 * Messages to a content script: from the side panel by way of the background,
 * plus one the service worker sends on its own (`ARM_NATIVE_OVERLAY`).
 *
 * Every variant may carry `tabId`: the tab the panel is bound to. The
 * background prefers it over its global `activeTabId`, which races
 * `chrome.tabs.onActivated` after a tab switch — without it, DISPATCH_ACTION
 * / SEND_KEY / CLOSE_TAB can hit the newly activated tab while the panel
 * still shows (or is clearing) the previous tab's tree.
 */
export type PanelToContent =
  | (BoundTab & { type: "REQUEST_TREE"; payload: TreeRequest })
  // Background→content recovery ping: re-announce your current tree.
  // Deliberately distinct from REQUEST_TREE, which carries the panel's
  // `TreeRequest` and assigns it. The one the background keeps for each tab
  // is gone after a restart, the only time it sends this, so it has none to
  // send — and it must not reset one either: the content script's
  // `currentViewMode` and `framesOnly` outlive a service-worker restart and
  // are the correct ones to re-announce at.
  | (BoundTab & { type: "RESEND_TREE" })
  | (BoundTab & { type: "DISPATCH_ACTION"; payload: ActionRequest })
  | (BoundTab & {
      type: "HIGHLIGHT_NODE";
      /**
       * `hover: true` marks a *preview* highlight (mousing over a row) rather
       * than a selection. Previews draw the overlay only — they must not
       * scroll the host page or move real focus, since a pointer sweeping the
       * tree would otherwise scroll-jump and fire focus handlers once per row.
       */
      payload: { nodeId: string; hover?: boolean };
    })
  | (BoundTab & { type: "CLEAR_HIGHLIGHT" })
  | (BoundTab & { type: "SET_VIEW_MODE"; payload: TreeRequest })
  | (BoundTab & { type: "TOGGLE_CURTAIN"; payload: { visible: boolean } })
  | (BoundTab & { type: "GET_FIELD_STATE"; payload: { nodeId: string } })
  | (BoundTab & {
      type: "SEND_KEY";
      payload: {
        key: string;
        code: string;
        keyCode: number;
        modifiers?: {
          shift?: boolean;
          ctrl?: boolean;
          alt?: boolean;
          meta?: boolean;
        };
      };
    })
  | (BoundTab & { type: "SET_FOCUS_TRACKER"; payload: { enabled: boolean } })
  // Sent by the SERVICE WORKER (native/index.ts, NATIVE_ACT's `reveal` and
  // `preview` branch), not the panel, around a native overlay. Armed
  // (`active: true`) before the dispatch and released (`active: false`, same
  // `seq`) after, it lets the content script honour exactly one event of its
  // `kind` — `real-a11y:native-reveal` or `real-a11y:native-preview` — the
  // one carrying `nonce`, and draw its overlay there: scrolled into view for
  // a reveal, in place for a preview. A reveal's arm also drops the one
  // `focusin` the reveal's focus causes, which the reverse focus-sync
  // listener would otherwise re-highlight and scroll to: the focus happens in
  // the page over chrome.debugger, so there is no in-process call to wrap the
  // way HIGHLIGHT_NODE wraps its own. A preview moves no focus, so its arm
  // drops none.
  | (BoundTab & {
      type: "ARM_NATIVE_OVERLAY";
      payload: {
        seq: number;
        active: boolean;
        nonce?: string;
        kind?: "reveal" | "preview";
      };
    })
  // Sent by the SERVICE WORKER (native/index.ts, NATIVE_READ), to every
  // frame, during a native read: number this frame's live document for read
  // `readId` and answer with the digest and the document's URL (what
  // `asFramePageKeyDigest` in native/page-keys.ts takes), so the read can
  // find the document over CDP and check it numbered the same elements
  // there. A reply without the URL numbers nothing. The content script keeps
  // the numbering for its FOCUS_CHANGED reports.
  | (BoundTab & { type: "NATIVE_PAGE_KEYS"; payload: { readId: string } })
  // Start/stop the (expensive) live tree observation in the content script.
  // Driven by the panel's connect/disconnect the same way SET_FOCUS_TRACKER
  // is, so a page whose panel was never opened does no observing at all.
  | (BoundTab & {
      type: "SET_OBSERVING";
      /** `tree`: the tree the panel last asked the tab for, which a frame
       *  armed after it was asked sends. Absent, the frame's own stands. */
      payload: { enabled: boolean; tree?: TreeRequest };
    })
  | (BoundTab & { type: "CLOSE_TAB" })
  // Picker: toggle DevTools-style "select an element in the page" mode.
  // Content swaps in the capture-phase click handler + cursor styling
  // when enabled, removes them when disabled.
  | (BoundTab & { type: "SET_PICK_MODE"; payload: { enabled: boolean } });

export type ExtensionMessage =
  ContentToPanel | PanelToContent | FrameToBackground;
