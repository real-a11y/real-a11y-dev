import type { ExtractionResult, SemanticNode } from "../types.js";

import { extractDomTree } from "./dom-extractor.js";

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
  const a11yNodes = new Map<string, SemanticNode>();

  // legend/summary: text is consumed as the fieldset/details accessible name.
  // Drop them AND their entire subtree — their content is already reflected in
  // the parent element's name.
  // NOTE: "label" is intentionally excluded here. For wrapping labels
  // (<label>Text<input /></label>) the form control inside must still appear
  // in the a11y tree, so labels are handled separately below (children promoted).
  const SUPPRESS_WITH_CHILDREN = new Set(["legend", "summary"]);

  // Identify which nodes to keep in the a11y tree
  const keepNode = (node: SemanticNode): boolean => {
    if (!node.a11y.isExposedToAT) return false;

    // role="presentation" / role="none" / <img alt=""> — element is
    // decorative and drops out of the AT tree per ARIA spec. Children are
    // still walked and promoted to the parent via the flattening branch.
    // Carve-out: a focusable element with role="presentation" keeps its
    // implicit role per spec (presenting it as decorative would lose
    // keyboard access), so we keep interactive presentational elements.
    if (node.a11y.role === "presentation") {
      return node.interaction.isInteractive;
    }

    // Keep nodes with meaningful roles (not generic)
    if (node.a11y.role !== "generic") return true;

    // Keep generic nodes that have an accessible name
    if (node.a11y.name) return true;

    // Keep generic nodes that are interactive
    if (node.interaction.isInteractive) return true;

    // Keep the root
    if (node.id === rootId) return true;

    return false;
  };

  // Second pass: build the filtered tree with correct parent/child relationships
  function processNode(
    nodeId: string,
    newParentId: string | null,
    depth: number,
  ): string[] {
    const node = domNodes.get(nodeId);
    if (!node) return [];

    if (!node.a11y.isExposedToAT) return [];

    // legend/summary: drop element AND all children — text is captured as the
    // fieldset/details accessible name.
    if (SUPPRESS_WITH_CHILDREN.has(node.dom.tagName)) return [];

    // label: suppress the label node itself but promote its children.
    // For wrapping labels (<label>Text<input /></label>), the form control
    // inside must still appear in the a11y tree with its accessible name
    // already computed from the label's text content in dom-extractor.ts.
    //
    // Only promote subtrees that lead to an interactive descendant. A text
    // carrier inside a label (<label><span>Email</span><input /></label>)
    // would otherwise surface as a standalone `generic "Email"` node —
    // redundant with the control's computed accessible name, and not what
    // a screen reader announces.
    if (node.dom.tagName === "label") {
      const promotedIds: string[] = [];
      for (const childId of node.childIds) {
        if (!hasInteractiveDescendant(childId, domNodes)) continue;
        const keptChildIds = processNode(childId, newParentId, depth);
        promotedIds.push(...keptChildIds);
      }
      return promotedIds;
    }

    if (keepNode(node)) {
      // This node stays — create an a11y version
      const a11yNode: SemanticNode = {
        ...node,
        parentId: newParentId,
        childIds: [],
        depth,
        ui: {
          ...node.ui,
          expanded: depth < 3,
        },
      };

      // Process children, which may flatten through skipped nodes
      for (const childId of node.childIds) {
        const keptChildIds = processNode(childId, node.id, depth + 1);
        a11yNode.childIds.push(...keptChildIds);
      }

      a11yNodes.set(node.id, a11yNode);
      return [node.id];
    } else {
      // This node is flattened — promote its children to the parent
      const promotedIds: string[] = [];
      for (const childId of node.childIds) {
        const keptChildIds = processNode(childId, newParentId, depth);
        promotedIds.push(...keptChildIds);
      }
      return promotedIds;
    }
  }

  processNode(rootId, null, 0);

  // Inherit focus only if the focused element survived a11y filtering — a
  // focused generic/decorative node that was flattened out isn't in this view.
  const focusedId =
    domFocusedId && a11yNodes.has(domFocusedId) ? domFocusedId : undefined;

  return { nodes: a11yNodes, rootId, ...(focusedId ? { focusedId } : {}) };
}

/**
 * True if `nodeId`'s subtree contains at least one interactive element
 * (self-inclusive). Used inside label handling to drop decorative/text-only
 * descendants whose content is already consumed as the control's accessible
 * name.
 */
function hasInteractiveDescendant(
  nodeId: string,
  domNodes: Map<string, SemanticNode>,
): boolean {
  const n = domNodes.get(nodeId);
  if (!n) return false;
  if (n.interaction.isInteractive) return true;
  for (const childId of n.childIds) {
    if (hasInteractiveDescendant(childId, domNodes)) return true;
  }
  return false;
}
