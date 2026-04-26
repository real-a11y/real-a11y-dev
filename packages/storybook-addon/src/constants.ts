import type { SemanticNode, TreeViewMode } from "@real-a11y-dev/core";

/** Unique addon id — used for the panel and the channel events. */
export const ADDON_ID = "real-a11y/semantic-navigator";
export const PANEL_ID = `${ADDON_ID}/panel`;

/** Channel events exchanged between the preview iframe and the manager UI. */
export const EVENTS = {
  /** Preview → manager: structured extraction result (on every DOM change). */
  TREE_UPDATED: `${ADDON_ID}/tree-updated`,
  /** Manager → preview: request the current tree immediately (e.g. on panel mount). */
  REQUEST_TREE: `${ADDON_ID}/request-tree`,
  /** Manager → preview: request a fresh extraction with a new view mode. */
  SET_MODE: `${ADDON_ID}/set-mode`,
  /** Manager → preview: highlight a DOM element by node id. */
  HIGHLIGHT_NODE: `${ADDON_ID}/highlight-node`,
  /** Manager → preview: clear the highlight overlay. */
  CLEAR_HIGHLIGHT: `${ADDON_ID}/clear-highlight`,
  /** Manager → preview: dispatch the primary action on a node. */
  ACTIVATE_NODE: `${ADDON_ID}/activate-node`,
} as const;

/**
 * A `SemanticNode` with `ui` state reset to defaults — safe to JSON-serialize
 * and send over the Storybook channel.
 *
 * `SemanticNode` itself contains no live DOM references (element refs live in
 * a separate WeakMap inside the extractor). The only transformation needed is
 * converting `Map<string, SemanticNode>` to an array, since Maps serialize
 * as `{}` in JSON.
 */
export type SerializableNode = SemanticNode;

/** Serializable form of ExtractionResult — safe to pass over the channel. */
export interface SerializableTree {
  /** The nodes as a JSON-safe `[id, node][]` array. */
  nodes: [string, SerializableNode][];
  rootId: string;
}

/** Payload sent from preview → manager on every DOM update. */
export interface TreeUpdatePayload {
  tree: SerializableTree;
  /** Which mode was used for this extraction. */
  mode: TreeViewMode;
  /** Timestamp (ms since epoch) of the extraction. */
  extractedAt: number;
}

/** The view mode the manager sends to the preview to request re-extraction. */
export type TreeMode = TreeViewMode;
