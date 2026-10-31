/**
 * What a frame's content script tells the service worker about the frames
 * inside its document: where each one's tree goes, and, while the panel
 * shows Chrome's tree, the frame's skeleton in place of its tree.
 *
 * Chrome's tree needs three things of the in-page walk: that a page is
 * there, when each of its frames changed, and which frames the page shows,
 * so that a hidden frame's changes, an animating ad's, prompt no read. The
 * service worker answers the last by putting each frame's tree under the
 * element holding it in its parent's (`mergeFrameTrees`) and looking at the
 * nodes on the way up (`frameVisibility`), which needs no more of a tree
 * than the elements holding frames. So while Chrome's tree shows, a frame
 * reads no tree: it sends its skeleton, the document's root element and
 * every element holding a frame, in the light DOM and open shadow roots
 * alike, each a child of the root, exposed to assistive technology where it
 * and every element around it is.
 *
 * Unlike the a11y view, the skeleton keeps a hidden element holding a frame,
 * unexposed, where the a11y walk has no node for it: a hidden frame then goes
 * under its own element, and is hidden, rather than taking another's place
 * or none.
 */

import {
  getElementRefs,
  getNodeId,
  isAriaHiddenValue,
  isHiddenFromAT,
  isRenderedInFlatTree,
  isSubtreeHidden,
  renderingParent,
  safeGetAttribute,
} from "@real-a11y-dev/core";
import type { SemanticNode } from "@real-a11y-dev/core";

import {
  FRAME_HOLDER_SELECTOR,
  frameOwnerMark,
  isFrameHolder,
} from "./frame-owner.js";

/** A frame's skeleton: see the module comment. */
export interface FrameSkeleton {
  nodes: Array<[string, SemanticNode]>;
  rootId: string;
  /** The skeleton's elements holding a frame whose script marked them, each
   *  with the mark: `FRAME_TREE_DATA.embeds`. */
  embeds: Array<[nodeId: string, owner: string]>;
}

// Through the prototypes: a named <img> or <form> called `querySelectorAll`
// shadows the document's own, and an element's `shadowRoot` can be shadowed
// the same way.
const querySelectorAll = Document.prototype.querySelectorAll;
const elementQuerySelectorAll = Element.prototype.querySelectorAll;
const fragmentQuerySelectorAll = DocumentFragment.prototype.querySelectorAll;
const shadowRootOf = Object.getOwnPropertyDescriptor(
  Element.prototype,
  "shadowRoot",
)?.get;

/** The elements holding a frame under `root`, in document order within
 *  each tree, and those in each open shadow root after the tree around it. */
function frameHolders(root: Element): Element[] {
  const out: Element[] = [];
  const visit = (scope: Element | ShadowRoot): void => {
    const query =
      scope instanceof Element
        ? elementQuerySelectorAll
        : fragmentQuerySelectorAll;
    out.push(...query.call(scope, FRAME_HOLDER_SELECTOR));
    for (const el of query.call(scope, "*")) {
      const shadow = shadowRootOf?.call(el);
      if (shadow) visit(shadow);
    }
  };
  visit(root);
  // A root element can be a shadow host: a custom element a page made its
  // document's root.
  const own = shadowRootOf?.call(root);
  if (own) visit(own);
  return out;
}

/** Whether the a11y walk from `root` finds `holder` exposed to assistive
 *  technology: rendered, not hidden itself, and inside nothing that hides
 *  what it holds. */
function exposed(holder: Element, root: Element): boolean {
  if (isHiddenFromAT(holder) || !isRenderedInFlatTree(holder)) return false;
  for (let el = renderingParent(holder); el; el = renderingParent(el)) {
    if (isSubtreeHidden(el)) return false;
    if (isAriaHiddenValue(safeGetAttribute(el, "aria-hidden"))) return false;
    if (el === root) break;
  }
  return true;
}

function skeletonNode(
  element: Element,
  parentId: string | null,
  isExposedToAT: boolean,
  childIds: string[] = [],
): SemanticNode {
  const src = safeGetAttribute(element, "src");
  return {
    id: getNodeId(element),
    parentId,
    childIds,
    depth: parentId === null ? 0 : 1,
    dom: {
      tagName: element.localName,
      attributes: src !== null ? { src } : {},
      textContent: null,
      descendantText: "",
      isHidden: !isExposedToAT,
    },
    a11y: {
      role: parentId === null ? "document" : "generic",
      name: "",
      description: "",
      states: {},
      properties: {},
      isExposedToAT,
    },
  };
}

/** The skeleton of the document under `root`, its root element. */
export function frameSkeleton(root: Element): FrameSkeleton {
  const rootId = getNodeId(root);
  const nodes: Array<[string, SemanticNode]> = [];
  const embeds: Array<[string, string]> = [];
  for (const holder of frameHolders(root)) {
    const node = skeletonNode(holder, rootId, exposed(holder, root));
    nodes.push([node.id, node]);
    const mark = frameOwnerMark(holder);
    if (mark !== undefined) embeds.push([node.id, mark]);
  }
  const top = skeletonNode(
    root,
    null,
    true,
    nodes.map(([id]) => id),
  );
  return { nodes: [[rootId, top], ...nodes], rootId, embeds };
}

/**
 * The tree's nodes for elements that hold a frame whose script marked them,
 * each with the mark: where the service worker puts that frame's tree (see
 * frame-owner.ts). A marked element the tree has no node for, as the a11y
 * view has none for a hidden <iframe>, goes with an empty node id: the
 * frame has no place in this tree, and the service worker needn't ask this
 * document where it is. One inside a shadow root isn't found that way, and
 * is asked after once.
 */
export function markedFrames(
  nodes: ReadonlyArray<[string, SemanticNode]>,
): Array<[nodeId: string, owner: string]> {
  const elementRefs = getElementRefs();
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
