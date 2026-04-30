/**
 * Pure frame-tree merging for the Chrome extension background script.
 *
 * Takes the per-frame trees the background has accumulated and the frame
 * hierarchy reported by `chrome.webNavigation.getAllFrames`, and produces
 * a single merged tree where each child frame's root is attached as a
 * child of the matching <iframe> node in its parent.
 *
 * Extracted from `background.ts` so the merge algorithm — which is where
 * iframe attachment bugs hide — can be unit-tested without standing up
 * the Chrome runtime.
 */

import type { SemanticNode } from "@real-a11y-dev/core";

import { prefixNodeId, urlsMatch } from "./routing.js";

export interface FrameTree {
  frameId: number;
  frameUrl: string;
  pageTitle: string;
  nodes: Array<[string, SemanticNode]>;
  rootId: string;
}

export interface FrameInfo {
  parentFrameId: number;
  url: string;
}

export interface MergeResult {
  /** Merged node map keyed by (possibly-prefixed) node id. */
  nodes: Map<string, SemanticNode>;
  /** For action routing: which frame each node lives in. */
  nodeToFrame: Map<string, number>;
}

/**
 * Merge per-frame trees into a single tree.
 *
 * Returns `null` if the top frame (frameId 0) has not announced itself yet —
 * there is nothing to render until then, and the caller should skip sending.
 */
export function mergeFrameTrees(opts: {
  frames: Map<number, FrameTree>;
  frameInfoMap: Map<number, FrameInfo>;
}): MergeResult | null {
  const topFrame = opts.frames.get(0);
  if (!topFrame) return null;

  const nodes = new Map<string, SemanticNode>();
  const nodeToFrame = new Map<string, number>();

  // Top frame keeps its node ids unprefixed.
  for (const [nodeId, node] of topFrame.nodes) {
    nodes.set(nodeId, { ...node });
    nodeToFrame.set(nodeId, 0);
  }

  const childFrameIds = Array.from(opts.frames.keys()).filter((id) => id !== 0);

  for (const childFrameId of childFrameIds) {
    const childTree = opts.frames.get(childFrameId);
    if (!childTree) continue;

    const frameInfo = opts.frameInfoMap.get(childFrameId);
    const parentFrameId = frameInfo?.parentFrameId ?? 0;

    const parentTree =
      parentFrameId === 0 ? topFrame : opts.frames.get(parentFrameId);
    if (!parentTree) continue;

    // Find the iframe node in the parent that points at this child frame.
    const parentFrameUrl = parentTree.frameUrl;
    let iframeNodeId: string | null = null;
    let iframeDepth = 0;

    for (const [nodeId, node] of parentTree.nodes) {
      if (node.dom.tagName === "iframe") {
        const src = node.dom.attributes.src || "";
        if (urlsMatch(src, childTree.frameUrl, parentFrameUrl)) {
          iframeNodeId = prefixNodeId(parentFrameId, nodeId);
          const parentNode = nodes.get(iframeNodeId);
          iframeDepth = parentNode?.depth ?? node.depth;
          break;
        }
      }
    }

    // Fallback: if URL matching failed, attach to the first un-attached
    // <iframe> in the parent. Beats dropping the subframe entirely.
    if (!iframeNodeId && frameInfo) {
      for (const [nodeId, node] of parentTree.nodes) {
        if (node.dom.tagName === "iframe") {
          const prefId = prefixNodeId(parentFrameId, nodeId);
          const parentNode = nodes.get(prefId);
          if (parentNode && parentNode.childIds.length === 0) {
            iframeNodeId = prefId;
            iframeDepth = parentNode.depth;
            break;
          }
        }
      }
    }

    const prefix = childFrameId;
    const depthOffset = iframeNodeId ? iframeDepth + 1 : 0;

    for (const [nodeId, node] of childTree.nodes) {
      const prefId = prefixNodeId(prefix, nodeId);
      const isRoot = nodeId === childTree.rootId;

      const adjustedNode: SemanticNode = {
        ...node,
        id: prefId,
        parentId: isRoot
          ? iframeNodeId
          : node.parentId
            ? prefixNodeId(prefix, node.parentId)
            : null,
        childIds: node.childIds.map((cid) => prefixNodeId(prefix, cid)),
        depth: node.depth + depthOffset,
        ui: { ...node.ui, expanded: node.depth + depthOffset < 3 },
      };

      nodes.set(prefId, adjustedNode);
      nodeToFrame.set(prefId, childFrameId);
    }

    // Attach child frame root as child of the iframe node in the parent.
    if (iframeNodeId) {
      const iframeNode = nodes.get(iframeNodeId);
      if (iframeNode) {
        const childRootPrefId = prefixNodeId(prefix, childTree.rootId);
        if (!iframeNode.childIds.includes(childRootPrefId)) {
          iframeNode.childIds = [...iframeNode.childIds, childRootPrefId];
        }
      }
    }
  }

  return { nodes, nodeToFrame };
}

/**
 * Build the frameId → {parentFrameId, url} map the merger needs from
 * Chrome's `webNavigation.getAllFrames` result. Tiny but stops the
 * background from open-coding it inline.
 */
export function buildFrameInfoMap(
  frames: ReadonlyArray<{
    frameId: number;
    parentFrameId: number;
    url: string;
  }>,
): Map<number, FrameInfo> {
  const map = new Map<number, FrameInfo>();
  for (const f of frames) {
    map.set(f.frameId, { parentFrameId: f.parentFrameId, url: f.url });
  }
  return map;
}
