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
 * Number of hops from `frameId` up to the top frame (frameId 0) by walking
 * the `parentFrameId` chain. The top frame is depth 0, its direct children
 * depth 1, grandchildren depth 2, and so on.
 *
 * Used to merge frames parent-first. A frame whose parent info is missing —
 * or unreachable because a chain link never announced — is treated as a
 * direct child of the top frame (depth 1), matching the `?? 0` parent
 * fallback the merge uses. The `seen` guard makes a malformed/cyclic chain
 * terminate instead of looping forever.
 */
function frameHierarchyDepth(
  frameId: number,
  frameInfoMap: Map<number, FrameInfo>,
): number {
  let depth = 0;
  let current = frameId;
  const seen = new Set<number>();
  while (current !== 0) {
    if (seen.has(current)) break;
    seen.add(current);
    const info = frameInfoMap.get(current);
    if (!info) break;
    depth++;
    current = info.parentFrameId;
  }
  return depth;
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

  // Process child frames parent-first. The map's key order is announce
  // order, and all frames run their content scripts independently at
  // document_idle — a light grandchild nested inside a heavy parent
  // routinely announces first. If we merged in that order, the grandchild
  // would be processed before its parent's prefixed nodes exist in `nodes`,
  // so the attach below (`nodes.get(iframeNodeId)`) would miss: the child's
  // root would never be linked into its parent iframe's `childIds` (leaving
  // the subtree present but unreachable, i.e. invisible in the rendered
  // tree) and its depth would fall back to the parent's frame-local depth.
  // Sorting by hierarchy depth guarantees a frame's parent is always merged
  // first, regardless of announce order.
  const childFrameIds = Array.from(opts.frames.keys())
    .filter((id) => id !== 0)
    .sort(
      (a, b) =>
        frameHierarchyDepth(a, opts.frameInfoMap) -
        frameHierarchyDepth(b, opts.frameInfoMap),
    );

  // <iframe> nodes already handed to a frame, as merged (prefixed) node ids.
  // An <iframe> element hosts exactly one frame, so once one child frame has
  // attached under it no other may. Without this, any two frames the URL
  // comparison cannot tell apart — the same widget embedded twice, differing
  // only by query string or not at all — both matched the FIRST such iframe
  // and piled into it, leaving the second iframe rendered empty.
  const claimedIframes = new Set<string>();

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

    /**
     * First unclaimed <iframe> in the parent satisfying `predicate`, as its
     * merged id plus the depth to nest the child frame under. `predicate` also
     * receives the already-merged copy of the node, which is where the
     * post-attachment `childIds` live.
     */
    const findIframe = (
      predicate: (
        node: SemanticNode,
        mergedNode: SemanticNode | undefined,
      ) => boolean,
    ): { id: string; depth: number } | null => {
      for (const [nodeId, node] of parentTree.nodes) {
        if (node.dom!.tagName !== "iframe") continue;
        const prefId = prefixNodeId(parentFrameId, nodeId);
        if (claimedIframes.has(prefId)) continue;
        const mergedNode = nodes.get(prefId);
        if (!predicate(node, mergedNode)) continue;
        return { id: prefId, depth: mergedNode?.depth ?? node.depth };
      }
      return null;
    };

    const srcOf = (node: SemanticNode) => node.dom!.attributes.src || "";

    const match =
      // 1. Exact match, query string included. The only pass that can tell
      //    apart sibling embeds whose urls differ solely by query.
      findIframe((node) =>
        urlsMatch(srcOf(node), childTree.frameUrl, parentFrameUrl, {
          matchQuery: true,
        }),
      ) ??
      // 2. Query-stripped match, as before — tolerates a frame url the page
      //    rewrote with params the markup's `src` never had.
      findIframe((node) =>
        urlsMatch(srcOf(node), childTree.frameUrl, parentFrameUrl),
      ) ??
      // 3. Fallback: first un-attached <iframe> in the parent. Beats dropping
      //    the subframe entirely.
      (frameInfo
        ? findIframe(
            (_node, mergedNode) =>
              mergedNode !== undefined && mergedNode.childIds.length === 0,
          )
        : null);

    const iframeNodeId = match?.id ?? null;
    const iframeDepth = match?.depth ?? 0;
    if (iframeNodeId) claimedIframes.add(iframeNodeId);

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
        ui: { ...node.ui!, expanded: node.depth + depthOffset < 3 },
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
