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
  | { type: "HIGHLIGHT_NODE"; payload: { nodeId: string } }
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
  | { type: "CLOSE_TAB" };

export type ExtensionMessage =
  | ContentToPanel
  | PanelToContent
  | FrameToBackground;
