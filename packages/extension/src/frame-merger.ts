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

import { asFrameMark, MAX_MARKED_FRAMES } from "./frame-owner.js";
import { prefixNodeId, urlsMatch } from "./routing.js";

export interface FrameTree {
  frameId: number;
  frameUrl: string;
  pageTitle: string;
  nodes: Array<[string, SemanticNode]>;
  rootId: string;
  /** The mark the frame's script left on the element holding the frame (see
   *  `frame-owner.ts`). Absent for the top frame, and for a frame of another
   *  origin than its parent's. */
  owner?: string;
  /**
   * This tree's nodes for elements holding a frame that marked them, each
   * with the mark. An empty node id is a marked element the tree has no node
   * for, as the a11y view has none for a hidden `<iframe>`: the frame's
   * place is known, and is nowhere in this tree.
   */
  embeds?: Array<[nodeId: string, owner: string]>;
  /** The frame sent its skeleton, not its tree (`frame-skeleton.ts`). */
  framesOnly?: true;
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
  /**
   * The frames that marked the element holding them where no tree bears the
   * mark: the tree of the document around such a frame was read before the
   * frame's script loaded. Each is left out of the tree's structure until
   * its place is known. A frame whose element a tree reports with no node
   * isn't among them: its place is known, and it has none in the tree.
   */
  unplaced: number[];
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
 *
 * `parentOf` answers a frame's parent, or undefined when nothing says.
 */
function frameHierarchyDepth(
  frameId: number,
  parentOf: (frameId: number) => number | undefined,
): number {
  let depth = 0;
  let current = frameId;
  const seen = new Set<number>();
  while (current !== 0) {
    if (seen.has(current)) break;
    seen.add(current);
    const parent = parentOf(current);
    if (parent === undefined) break;
    depth++;
    current = parent;
  }
  return depth;
}

/** Where a frame's mark says its tree goes: the frame whose tree has the
 *  node bearing it, and that node's id there. */
interface Placement {
  frameId: number;
  nodeId: string;
}

/**
 * Each marked frame's place, for the frames whose mark exactly one node of
 * the trees bears. A mark on two nodes names neither: a frame is held by
 * one element.
 */
function placeMarkedFrames(
  frames: Map<number, FrameTree>,
): Map<number, Placement> {
  const borne = new Map<string, Placement | null>();
  for (const [frameId, tree] of frames) {
    for (const [nodeId, mark] of tree.embeds ?? []) {
      borne.set(mark, borne.has(mark) ? null : { frameId, nodeId });
    }
  }
  const placed = new Map<number, Placement>();
  for (const [frameId, tree] of frames) {
    const place = tree.owner !== undefined ? borne.get(tree.owner) : null;
    if (frameId !== 0 && place && place.frameId !== frameId) {
      placed.set(frameId, place);
    }
  }
  return placed;
}

/**
 * The frames still in the page: the top frame, each frame Chrome lists
 * (`listed`), and each one its mark places in the tree of a frame still in
 * the page, whatever Chrome lists. Chrome lists no `javascript:` frame,
 * though the content script runs in one. A frame whose <iframe> the page
 * removed is none of them, once the document around it has sent its tree
 * again, and nor is a frame inside it, whose mark only that frame's last
 * tree still bears.
 */
export function liveFrames(
  frames: Map<number, FrameTree>,
  listed: ReadonlyMap<number, unknown>,
): Set<number> {
  const live = new Set([0, ...listed.keys()]);
  const placed = placeMarkedFrames(frames);
  for (let grew = true; grew;) {
    grew = false;
    for (const [frameId, place] of placed) {
      if (!live.has(frameId) && live.has(place.frameId)) {
        live.add(frameId);
        grew = true;
      }
    }
  }
  return live;
}

/** The frames that marked the element holding them where no tree has a node
 *  bearing the mark: see `MergeResult.unplaced`. */
export function unplacedFrames(frames: Map<number, FrameTree>): number[] {
  const placed = placeMarkedFrames(frames);
  return [...frames]
    .filter(
      ([frameId, tree]) =>
        frameId !== 0 && tree.owner !== undefined && !placed.has(frameId),
    )
    .map(([frameId]) => frameId);
}

/**
 * Whether a frame's document shows on the page, as the merged `nodes` have
 * it. Chrome's tree reads a frame only where its `<iframe>` has a row, and
 * the DOM walk stops at anything hidden from assistive technology, so:
 *
 * - `"shown"`: its root hangs under the top frame's root (`topRootId`)
 *   through nodes all exposed to assistive technology, its `<iframe>`'s
 *   among them.
 * - `"hidden"`: a node on the way up is hidden from assistive technology, as
 *   a hidden frame's (an ad's, a tracker's) `<iframe>` is.
 * - `"unplaced"`: the way up ends short of the top frame: the frame, or a
 *   frame around it, has no place in the tree yet.
 *
 * Only as good as the merge's placement, which for a frame of another origin
 * whose URL matches no `<iframe>` is a guess (see {@link mergeFrameTrees}).
 */
export function frameVisibility(
  nodes: ReadonlyMap<string, SemanticNode>,
  frame: Pick<FrameTree, "frameId" | "rootId">,
  topRootId: string,
): "shown" | "hidden" | "unplaced" {
  if (frame.frameId === 0) return "shown";
  let id: string | null = prefixNodeId(frame.frameId, frame.rootId);
  // Bounded by the node count: a malformed tree with a parent cycle ends.
  for (let steps = 0; id !== null && steps <= nodes.size; steps++) {
    if (id === topRootId) return "shown";
    const node = nodes.get(id);
    if (!node) return "unplaced";
    if (node.a11y.isExposedToAT === false) return "hidden";
    id = node.parentId;
  }
  return "unplaced";
}

/**
 * Merge per-frame trees into a single tree.
 *
 * Returns `null` if the top frame (frameId 0) has not announced itself yet —
 * there is nothing to render until then, and the caller should skip sending.
 *
 * A child frame's tree goes under the node of the element holding the frame.
 * A frame that marked that element (`FrameTree.owner`) says which it is, and
 * is placed by the mark alone: this is the only thing that tells apart the
 * frames a page makes with no URL of their own, which all show `about:blank`
 * or `about:srcdoc`. Any other frame is placed by comparing its URL with
 * each `<iframe>`'s `src`, as below.
 */
export function mergeFrameTrees(opts: {
  frames: Map<number, FrameTree>;
  frameInfoMap: Map<number, FrameInfo>;
  /** The unplaced marked frames known to have no place in any tree: the
   *  document around each has been read again since, and bears no such
   *  mark. They hold no other frame's place back. */
  unplaceable?: ReadonlySet<number>;
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
  //
  // Frames Chrome still reports are ordered ahead of ones it doesn't, so a
  // live frame always picks its <iframe> before a stale tree can. `frames`
  // is not pruned when an <iframe> ELEMENT is removed — the background drops
  // a frame only when it NAVIGATES, and a deleted iframe never navigates — so
  // a page that swaps an embed for an equal-src one (ad refresh, widget
  // re-mount) leaves the dead frame's tree in the map. It is absent from
  // `frameInfoMap`, which means frameHierarchyDepth walks a chain it isn't in
  // and returns 0: without this tie-break it would sort ahead of every live
  // child frame, claim the iframe, and leave the live frame that actually
  // hosts the document attached to nothing and so invisible.
  //
  // A frame placed by its mark is live whatever Chrome reports: the element
  // bearing the mark is in a tree now. Chrome lists no `javascript:` frame,
  // though the content script runs in one.
  const placed = placeMarkedFrames(opts.frames);
  const parentOf = (id: number) =>
    placed.get(id)?.frameId ?? opts.frameInfoMap.get(id)?.parentFrameId;
  const isLive = (id: number) =>
    placed.has(id) || opts.frameInfoMap.has(id) ? 0 : 1;
  const childFrameIds = Array.from(opts.frames.keys())
    .filter((id) => id !== 0)
    .sort(
      (a, b) =>
        isLive(a) - isLive(b) ||
        frameHierarchyDepth(a, parentOf) - frameHierarchyDepth(b, parentOf),
    );

  // <iframe> nodes already handed to a frame, as merged (prefixed) node ids.
  // An <iframe> element hosts exactly one frame, so once one child frame has
  // attached under it no other may. Without this, any two frames the URL
  // comparison cannot tell apart — the same widget embedded twice, differing
  // only by query string or not at all — both matched the FIRST such iframe
  // and piled into it, leaving the second iframe rendered empty.
  //
  // The nodes marked frames are placed under are theirs from the start, so
  // no frame placed by URL, or by the last-resort guess below, takes one.
  const claimedIframes = new Set<string>();
  for (const { frameId, nodeId } of placed.values()) {
    claimedIframes.add(prefixNodeId(frameId, nodeId));
  }
  const unplaced: number[] = [];
  // The parents holding a marked frame that isn't placed yet. Its element is
  // one of that parent's, in a tree that doesn't say which yet, so the
  // last-resort guess is not taken under such a parent meanwhile: the empty
  // <iframe> it would hand another frame may be this one's. A frame Chrome
  // no longer lists holds nothing back, nor one known to have no place: its
  // element is none the tree has a node for, so no guess can take it.
  const awaited = new Set<number>();
  for (const [frameId, tree] of opts.frames) {
    const parent = opts.frameInfoMap.get(frameId)?.parentFrameId;
    if (
      frameId !== 0 &&
      tree.owner !== undefined &&
      !placed.has(frameId) &&
      !opts.unplaceable?.has(frameId) &&
      parent !== undefined
    ) {
      awaited.add(parent);
    }
  }

  /**
   * First unclaimed <iframe> in `parentTree`, frame `parentFrameId`'s,
   * satisfying `predicate`, as its merged id plus the depth to nest the child
   * frame under, as merged so far. `predicate` also receives the
   * already-merged copy of the node, which is where the post-attachment
   * `childIds` live.
   */
  const findIframe = (
    parentFrameId: number,
    parentTree: FrameTree,
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

  /**
   * The first unclaimed <iframe> in `parentTree`, frame `parentFrameId`'s,
   * whose `src` names the URL of `childTree`'s frame, in one of two passes:
   *
   * 1. Exact match, query string included (`matchQuery`). The only pass that
   *    can tell apart sibling embeds whose urls differ solely by query.
   * 2. Query-stripped match, as before — tolerates a frame url the page
   *    rewrote with params the markup's `src` never had.
   */
  const findBySrc = (
    childTree: FrameTree,
    parentFrameId: number,
    parentTree: FrameTree,
    matchQuery: boolean,
  ): { id: string; depth: number } | null =>
    findIframe(parentFrameId, parentTree, (node) =>
      urlsMatch(srcOf(node), childTree.frameUrl, parentTree.frameUrl, {
        matchQuery,
      }),
    );

  /** Both passes for one frame, the exact one first. */
  const findByUrl = (
    childTree: FrameTree,
    parentFrameId: number,
    parentTree: FrameTree,
  ): { id: string; depth: number } | null =>
    findBySrc(childTree, parentFrameId, parentTree, true) ??
    findBySrc(childTree, parentFrameId, parentTree, false);

  // Every frame Chrome lists takes the <iframe> its URL names exactly (1),
  // then each one left takes the <iframe> its URL names but for the query
  // (2), all before any frame is guessed one (3, below). A hidden tracker's
  // or ad's <iframe> has no node in the a11y view, so its frame's URL names
  // none exactly: it is matched without the query, or guessed. And such a
  // frame routinely announces before the embeds a page shows. Matched frame
  // by frame in announce order, it took the <iframe> of an embed that
  // announced after it: the tracker's content showed under the embed's
  // <iframe>, and the embed's own, finding its <iframe> taken, was left out.
  // A frame Chrome doesn't list is still matched in its turn below, after
  // every guess: a stale tree takes no <iframe> a live frame could have.
  const byUrl = new Map<number, { id: string; depth: number }>();
  for (const matchQuery of [true, false]) {
    for (const childFrameId of childFrameIds) {
      const childTree = opts.frames.get(childFrameId);
      const frameInfo = opts.frameInfoMap.get(childFrameId);
      if (!childTree || !frameInfo || placed.has(childFrameId)) continue;
      const parentTree = opts.frames.get(frameInfo.parentFrameId);
      if (!parentTree || byUrl.has(childFrameId)) continue;
      const match = findBySrc(
        childTree,
        frameInfo.parentFrameId,
        parentTree,
        matchQuery,
      );
      if (match) {
        claimedIframes.add(match.id);
        byUrl.set(childFrameId, match);
      }
    }
  }

  for (const childFrameId of childFrameIds) {
    const childTree = opts.frames.get(childFrameId);
    if (!childTree) continue;

    const frameInfo = opts.frameInfoMap.get(childFrameId);
    const place = placed.get(childFrameId);
    const parentFrameId = place?.frameId ?? frameInfo?.parentFrameId ?? 0;

    const parentTree =
      parentFrameId === 0 ? topFrame : opts.frames.get(parentFrameId);
    if (!parentTree) continue;

    // A frame that marked its element and isn't placed by the mark has its
    // place in no tree yet. Its URL may still say where (1 and 2), but the
    // guess (3) is never taken for it: it is held by one element, which is
    // none of those the guess would pick from now.
    const marked = childTree.owner !== undefined;
    if (marked && !place) unplaced.push(childFrameId);

    // Find the iframe node in the parent that points at this child frame.
    const byMark = (at: Placement): { id: string; depth: number } | null => {
      const id = prefixNodeId(at.frameId, at.nodeId);
      const mergedNode = nodes.get(id);
      return mergedNode ? { id, depth: mergedNode.depth } : null;
    };
    const match = place
      ? byMark(place)
      : // 1 and 2, by URL: matched above for a frame Chrome lists, and now
        //    for one it doesn't, which sorts after every frame it does.
        ((frameInfo
          ? byUrl.get(childFrameId)
          : findByUrl(childTree, parentFrameId, parentTree)) ??
        // 3. Fallback: first un-attached <iframe> in the parent. Beats
        //    dropping the subframe entirely.
        (frameInfo && !marked && !awaited.has(parentFrameId)
          ? findIframe(
              parentFrameId,
              parentTree,
              (_node, mergedNode) =>
                mergedNode !== undefined && mergedNode.childIds.length === 0,
            )
          : null));

    const iframeNodeId = match?.id ?? null;
    // Its depth as merged by now: an <iframe> in a frame inside another may
    // have been matched by its `src` above, before that frame was merged.
    const iframeDepth = match ? (nodes.get(match.id)?.depth ?? match.depth) : 0;
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

  return { nodes, nodeToFrame, unplaced };
}

/**
 * The marks of a frame's `FRAME_TREE_DATA`, kept only where they are well
 * formed. A content script runs in the page's process, so its message is
 * checked before any of it decides where a tree goes.
 */
export function asFrameMarks(payload: {
  owner?: unknown;
  embeds?: unknown;
}): Pick<FrameTree, "owner" | "embeds"> {
  const owner = asFrameMark(payload.owner);
  const embeds: Array<[string, string]> = [];
  if (Array.isArray(payload.embeds)) {
    for (const entry of payload.embeds.slice(
      0,
      MAX_MARKED_FRAMES,
    ) as unknown[]) {
      if (!Array.isArray(entry)) continue;
      const [nodeId, mark] = entry as unknown[];
      const held = asFrameMark(mark);
      if (typeof nodeId === "string" && held !== undefined) {
        embeds.push([nodeId, held]);
      }
    }
  }
  return {
    ...(owner !== undefined ? { owner } : {}),
    ...(embeds.length > 0 ? { embeds } : {}),
  };
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
