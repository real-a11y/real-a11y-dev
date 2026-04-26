import type { SemanticNode, TreeViewMode, ActionRequest, ActionResult } from "@real-a11y-dev/core";

/** Messages from content script frame → background (per-frame tree data) */
export type FrameToBackground =
  | { type: "FRAME_TREE_DATA"; payload: { frameUrl: string; pageTitle: string; nodes: Array<[string, SemanticNode]>; rootId: string } }
  | { type: "FOCUS_CHANGED"; payload: { nodeId: string } }
  | { type: "LIVE_REGION"; payload: { text: string; level: "polite" | "assertive"; role: string } };

/** Messages from background → side panel (merged tree) */
export type ContentToPanel =
  | { type: "TREE_DATA"; payload: { nodes: Array<[string, SemanticNode]>; rootId: string; pageTitle: string; pageUrl: string } }
  | { type: "TREE_UPDATED"; payload: { nodes: Array<[string, SemanticNode]>; rootId: string } }
  | { type: "ACTION_RESULT"; payload: ActionResult }
  | { type: "NAVIGATION"; payload: { url: string } }
  | { type: "FOCUS_CHANGED"; payload: { nodeId: string } }
  | { type: "LIVE_REGION"; payload: { text: string; level: "polite" | "assertive"; role: string } };

/** Select option for GET_FIELD_STATE response */
export interface SelectOption {
  value: string;
  label: string;
  selected: boolean;
}

/** Messages from side panel → background → content script */
export type PanelToContent =
  | { type: "REQUEST_TREE"; payload: { viewMode: TreeViewMode } }
  | { type: "DISPATCH_ACTION"; payload: ActionRequest }
  | { type: "HIGHLIGHT_NODE"; payload: { nodeId: string } }
  | { type: "CLEAR_HIGHLIGHT" }
  | { type: "SET_VIEW_MODE"; payload: { viewMode: TreeViewMode } }
  | { type: "TOGGLE_CURTAIN"; payload: { visible: boolean } }
  | { type: "GET_FIELD_STATE"; payload: { nodeId: string } }
  | { type: "SEND_KEY"; payload: { key: string; code: string; keyCode: number; modifiers?: { shift?: boolean; ctrl?: boolean; alt?: boolean; meta?: boolean } } }
  | { type: "SET_FOCUS_TRACKER"; payload: { enabled: boolean } }
  | { type: "CLOSE_TAB" };

export type ExtensionMessage = ContentToPanel | PanelToContent | FrameToBackground;
