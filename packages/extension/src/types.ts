import type {
  SemanticNode,
  TreeViewMode,
  ActionRequest,
  ActionResult,
} from "@real-a11y-dev/core";

/** One option of a native `<select>`, as returned by GET_FIELD_STATE. */
export interface SelectOption {
  value: string;
  label: string;
  selected: boolean;
}

/**
 * Optional tab the side panel is bound to. Panel→content commands stamp this
 * so the background prefers it over its global `activeTabId` (which races
 * `chrome.tabs.onActivated` after a tab switch).
 */
type BoundTab = { tabId?: number };

/**
 * Messages from content script / background → side panel.
 *
 * The side panel filters by `tabId` to discard updates that aren't for the
 * tab it is currently bound to. Without that filter, a panel that was
 * pointed at tab A starts showing tab B's tree. `tabId` is optional only
 * for legacy / panel-internal messages.
 */
export type ContentToPanel =
  | {
      type: "TREE_DATA";
      tabId?: number;
      payload: {
        nodes: [string, SemanticNode][];
        rootId: string;
        pageTitle?: string;
        pageUrl?: string;
      };
    }
  | {
      type: "TREE_UPDATED";
      tabId?: number;
      payload: {
        nodes: [string, SemanticNode][];
        rootId: string;
      };
    }
  | { type: "ACTION_RESULT"; tabId?: number; payload: ActionResult }
  | { type: "NAVIGATION"; tabId?: number; payload: { url: string } }
  | { type: "FOCUS_CHANGED"; tabId?: number; payload: { nodeId: string } }
  | {
      type: "LIVE_REGION";
      tabId?: number;
      payload: { text: string; politeness: "polite" | "assertive" };
    }
  | {
      // Background notifies the panel which tab is now active. The panel
      // adopts that as its bound tab. The background is the canonical writer
      // for activeTabId.
      type: "ACTIVE_TAB_CHANGED";
      tabId: number;
    }
  | { type: "NODE_PICKED"; tabId?: number; payload: { nodeId: string } }
  | {
      type: "PICK_MODE_CHANGED";
      tabId?: number;
      payload: { enabled: boolean };
    };

/**
 * Messages from side panel → background → content script.
 *
 * Every variant may carry `tabId`: the tab the panel is bound to. The
 * background prefers it over its global `activeTabId`, which races
 * `chrome.tabs.onActivated` after a tab switch — without it, DISPATCH_ACTION
 * / SEND_KEY / CLOSE_TAB can hit the newly activated tab while the panel
 * still shows (or is clearing) the previous tab's tree.
 */
export type PanelToContent =
  | (BoundTab & {
      type: "REQUEST_TREE";
      payload: { viewMode: TreeViewMode };
    })
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
  | (BoundTab & { type: "SET_VIEW_MODE"; payload: { viewMode: TreeViewMode } })
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
  // Start/stop the (expensive) live tree observation in the content script.
  // Driven by the panel's connect/disconnect the same way SET_FOCUS_TRACKER
  // is, so a page whose panel was never opened does no observing at all.
  | (BoundTab & { type: "SET_OBSERVING"; payload: { enabled: boolean } })
  | (BoundTab & { type: "CLOSE_TAB" })
  // Picker: toggle DevTools-style "select an element in the page" mode.
  // Content swaps in the capture-phase click handler + cursor styling
  // when enabled, removes them when disabled.
  | (BoundTab & { type: "SET_PICK_MODE"; payload: { enabled: boolean } });

/** Per-frame tree payload from a content script to the background. */
export type FrameToBackground =
  | {
      type: "FRAME_TREE_DATA";
      payload: {
        frameUrl: string;
        pageTitle?: string;
        nodes: [string, SemanticNode][];
        rootId: string;
      };
    }
  | { type: "FRAME_HELLO" }
  | { type: "FRAME_GONE" };

export type ExtensionMessage =
  ContentToPanel | PanelToContent | FrameToBackground;
