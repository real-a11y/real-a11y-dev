import type { ExtractionResult, SemanticNode } from "../types.js";

import { extractDomTree, getElementRefs } from "./dom-extractor.js";

// See SUPPRESS_KEEP_INTERACTIVE.
const SUPPRESS_KEEP_INTERACTIVE = new Set(["legend", "summary", "label"]);

// Identify which nodes to keep in the a11y tree
function keepNode(node: SemanticNode, rootId: string): boolean {
  if (!node.a11y.isExposedToAT) return false;

  // role="presentation" / role="none" / <img alt=""> — element is
  // decorative and drops out of the AT tree per ARIA spec. Children are
  // still walked and promoted to the parent via the flattening branch.
  // Carve-out: a focusable element with role="presentation" keeps its
  // implicit role per spec (presenting it as decorative would lose
  // keyboard access), so we keep interactive presentational elements.
  if (node.a11y.role === "presentation") {
    return node.interaction!.isInteractive;
  }

  // Keep nodes with meaningful roles (not generic)
  if (node.a11y.role !== "generic") return true;

  // Keep generic nodes that have an accessible name
  if (node.a11y.name) return true;

  // Keep generic nodes that are interactive
  if (node.interaction!.isInteractive) return true;

  // Keep the root
  if (node.id === rootId) return true;

  return false;
}

/**
 * True if `nodeId`'s subtree contains at least one interactive element
 * (self-inclusive). Used inside SUPPRESS_KEEP_INTERACTIVE handling to drop
 * decorative/text-only descendants whose content is already consumed as the
 * container's accessible name.
 */
function hasInteractiveDescendant(
  nodeId: string,
  domNodes: Map<string, SemanticNode>,
): boolean {
  const n = domNodes.get(nodeId);
  if (!n) return false;
  if (n.interaction!.isInteractive) return true;
  for (const childId of n.childIds) {
    if (hasInteractiveDescendant(childId, domNodes)) return true;
  }
  return false;
}

/**
 * A caption is suppressed only when it actually supplied the table's name.
 * Keying on the tag alone deletes "Open support tickets" from
 * `<table aria-label="Escalations"><caption>Open support tickets</caption>`
 * — the words are on screen, Chrome keeps a caption node, and a heading or
 * `img alt` inside would vanish from heading-order / missing-alt audits.
 */
function captionSuppliedTableName(
  node: SemanticNode,
  domNodes: Map<string, SemanticNode>,
): boolean {
  if (node.dom?.tagName !== "caption" || !node.parentId) return false;
  const parent = domNodes.get(node.parentId);
  if (parent?.dom?.tagName !== "table") return false;
  // `aria-labelledby` is not in KEY_ATTRIBUTES, so it never appears on
  // `dom.attributes`. `aria-label` does. Read labelledby from the live
  // element or a matching-name labelledby table would look identical to
  // "caption supplied the name" and the caption (and any heading / img
  // inside it) would be deleted.
  if (parent.dom.attributes["aria-label"]) return false;
  const tableEl = getElementRefs().get(parent.id);
  if (tableEl?.hasAttribute("aria-labelledby")) return false;
  const captionName = node.a11y.name?.trim();
  return !!captionName && parent.a11y.name === captionName;
}

// Second pass: build the filtered tree with correct parent/child relationships
function processNode(
  nodeId: string,
  newParentId: string | null,
  depth: number,
  domNodes: Map<string, SemanticNode>,
  a11yNodes: Map<string, SemanticNode>,
  rootId: string,
): string[] {
  const node = domNodes.get(nodeId);
  if (!node) return [];

  if (!node.a11y.isExposedToAT) return [];

  // See SUPPRESS_KEEP_INTERACTIVE. Caption is gated separately: it is only
  // suppressed when it actually supplied the table's name.
  if (
    SUPPRESS_KEEP_INTERACTIVE.has(node.dom!.tagName) ||
    captionSuppliedTableName(node, domNodes)
  ) {
    const promotedIds: string[] = [];
    for (const childId of node.childIds) {
      if (!hasInteractiveDescendant(childId, domNodes)) continue;
      const keptChildIds = processNode(
        childId,
        newParentId,
        depth,
        domNodes,
        a11yNodes,
        rootId,
      );
      promotedIds.push(...keptChildIds);
    }
    return promotedIds;
  }

  if (keepNode(node, rootId)) {
    // This node stays — create an a11y version
    const a11yNode: SemanticNode = {
      ...node,
      parentId: newParentId,
      childIds: [],
      depth,
      ui: {
        ...node.ui!,
        expanded: depth < 3,
      },
    };

    // Process children, which may flatten through skipped nodes
    for (const childId of node.childIds) {
      const keptChildIds = processNode(
        childId,
        node.id,
        depth + 1,
        domNodes,
        a11yNodes,
        rootId,
      );
      a11yNode.childIds.push(...keptChildIds);
    }

    a11yNodes.set(node.id, a11yNode);
    return [node.id];
  } else {
    // This node is flattened — promote its children to the parent
    const promotedIds: string[] = [];
    for (const childId of node.childIds) {
      const keptChildIds = processNode(
        childId,
        newParentId,
        depth,
        domNodes,
        a11yNodes,
        rootId,
      );
      promotedIds.push(...keptChildIds);
    }
    return promotedIds;
  }
}

/**
 * Build an accessibility tree projection from an existing DOM tree map.
 *
 * This is the second half of {@link extractA11yTree}: it takes the DOM-level
 * `SemanticNode` map and filters/flattens it into the view a screen reader
 * would expose. It is exposed separately so {@link LiveTreeExtractor} can
 * reuse it after incrementally patching the DOM map.
 */
export function buildA11yTree(
  domNodes: Map<string, SemanticNode>,
  rootId: string,
  focusedId?: string,
): ExtractionResult {
  const a11yNodes = new Map<string, SemanticNode>();
  processNode(rootId, null, 0, domNodes, a11yNodes, rootId);

  // Inherit focus only if the focused element survived a11y filtering — a
  // focused generic/decorative node that was flattened out isn't in this view.
  const a11yFocusedId =
    focusedId && a11yNodes.has(focusedId) ? focusedId : undefined;

  return {
    nodes: a11yNodes,
    rootId,
    ...(a11yFocusedId ? { focusedId: a11yFocusedId } : {}),
    source: { producer: "dom" },
  };
}

/**
 * Extract an accessibility tree by filtering the DOM tree
 * to only show nodes exposed to assistive technology.
 *
 * In the a11y view, nodes with role="generic" that have no accessible name
 * are "flattened" — their children are promoted to the parent level.
 * This produces a tree that more closely matches what a screen reader sees.
 */
export function extractA11yTree(root: Element): ExtractionResult {
  const {
    nodes: domNodes,
    rootId,
    focusedId: domFocusedId,
  } = extractDomTree(root);
  return buildA11yTree(domNodes, rootId, domFocusedId);
}
