import type {
  SemanticNode,
  TreeViewMode,
  ActionRequest,
  ActionResult,
} from "@real-a11y-dev/core";

/** Messages from content script frame → background (per-frame tree data) */
export type FrameToBackground =
  | {
      type: "FRAME_TREE_DATA";
      payload: {
        frameUrl: string;
        pageTitle: string;
        nodes: Array<[string, SemanticNode]>;
        rootId: string;
      };
    }
  // Cheap "I'm here" announce sent at content-script load, carrying no tree.
  // It lets the background learn a frame is reachable so it can tell the
  // frame to start observing IFF a panel is connected — without paying a
  // full extraction on every page whether or not the panel is ever opened.
  | { type: "FRAME_HELLO"; payload: { frameUrl: string } }
  | { type: "FOCUS_CHANGED"; payload: { nodeId: string } }
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
      };
    }
  | {
      type: "TREE_UPDATED";
      tabId?: number;
      payload: { nodes: Array<[string, SemanticNode]>; rootId: string };
    }
  | { type: "ACTION_RESULT"; tabId?: number; payload: ActionResult }
  | { type: "NAVIGATION"; tabId?: number; payload: { url: string } }
  | { type: "FOCUS_CHANGED"; tabId?: number; payload: { nodeId: string } }
  | {
      type: "LIVE_REGION";
      tabId?: number;
      payload: { text: string; level: "polite" | "assertive"; role: string };
    }
  | {
      // Background → panel push: the active tab in the panel's window
      // has changed. Panel uses this as its source of truth for myTabId
      // because the background's `chrome.tabs.onActivated` listener is
      // the canonical writer for activeTabId.
      type: "ACTIVE_TAB_CHANGED";
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
    };

/** Select option for GET_FIELD_STATE response */
export interface SelectOption {
  value: string;
  label: string;
  selected: boolean;
}

/**
 * Messages from side panel → background → content script.
 *
 * `REQUEST_TREE` carries an optional `tabId` so the background routes to
 * exactly the tab the panel intends — without it, the request races
 * `chrome.tabs.onActivated`'s update of the background's `activeTabId`,
 * and a tab-switch-triggered REQUEST_TREE may target the previous tab.
 */
export type PanelToContent =
  | {
      type: "REQUEST_TREE";
      tabId?: number;
      payload: { viewMode: TreeViewMode };
    }
  | { type: "DISPATCH_ACTION"; payload: ActionRequest }
  | {
      type: "HIGHLIGHT_NODE";
      /**
       * `hover: true` marks a *preview* highlight (mousing over a row) rather
       * than a selection. Previews draw the overlay only — they must not
       * scroll the host page or move real focus, since a pointer sweeping the
       * tree would otherwise scroll-jump and fire focus handlers once per row.
       */
      payload: { nodeId: string; hover?: boolean };
    }
  | { type: "CLEAR_HIGHLIGHT" }
  | { type: "SET_VIEW_MODE"; payload: { viewMode: TreeViewMode } }
  | { type: "TOGGLE_CURTAIN"; payload: { visible: boolean } }
  | { type: "GET_FIELD_STATE"; payload: { nodeId: string } }
  | {
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
    }
  | { type: "SET_FOCUS_TRACKER"; payload: { enabled: boolean } }
  // Start/stop the (expensive) live tree observation in the content script.
  // Driven by the panel's connect/disconnect the same way SET_FOCUS_TRACKER
  // is, so a page whose panel was never opened does no observing at all.
  | { type: "SET_OBSERVING"; payload: { enabled: boolean } }
  | { type: "CLOSE_TAB" }
  // Picker: toggle DevTools-style "select an element in the page" mode.
  // Content swaps in the capture-phase click handler + cursor styling
  // when enabled, removes them when disabled.
  | { type: "SET_PICK_MODE"; payload: { enabled: boolean } };

export type ExtensionMessage =
  ContentToPanel | PanelToContent | FrameToBackground;
