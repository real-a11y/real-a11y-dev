import type { ExtractionResult, SemanticNode } from "../types.js";

import { extractDomTree, getElementRefs } from "./dom-extractor.js";
import { isHiddenOnlyByVisibility } from "./visibility-hidden.js";

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

  // HTML-AAM's header/footer-in-sectioning-content roles. Its mapping note
  // says user agents MAY leave them unexposed when the element has no
  // accessible name, isn't focusable and carries no other global ARIA
  // attribute — so they flatten like a bare `generic`, with those extra keep
  // conditions below. The native normalizer applies the matching rule
  // (`NATIVE_AX_DROP_WHEN_BARE`) so both producers agree.
  const role = node.a11y.role;
  const sectioned = role === "sectionheader" || role === "sectionfooter";

  // Keep nodes with meaningful roles (not generic)
  if (!sectioned && role !== "generic") return true;

  // Keep named or interactive generics, and the root — and a generic holding a
  // value: a role-less editor is a field (ADR-0001), not a wrapper to fold.
  if (
    node.a11y.name ||
    node.a11y.value !== undefined ||
    node.interaction!.isInteractive ||
    node.id === rootId
  )
    return true;

  // "Another global ARIA attribute", as far as the node records it:
  // `dom.attributes` holds only KEY_ATTRIBUTES (no `aria-describedby`), but a
  // describedby reference surfaces as a computed description instead, and
  // aria-busy (not a KEY_ATTRIBUTE) lands in `a11y.states`.
  return (
    sectioned &&
    (node.interaction!.isFocusable ||
      !!node.a11y.description ||
      "busy" in node.a11y.states ||
      Object.keys(node.dom?.attributes ?? {}).some(
        (name) => name.startsWith("aria-") && name !== "aria-hidden",
      ))
  );
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

/** What the second pass shares across every recursive call. */
interface FilterContext {
  domNodes: Map<string, SemanticNode>;
  a11yNodes: Map<string, SemanticNode>;
  rootId: string;
}

// Second pass: build the filtered tree with correct parent/child relationships
function processNode(
  nodeId: string,
  newParentId: string | null,
  depth: number,
  ctx: FilterContext,
): string[] {
  const { domNodes, a11yNodes, rootId } = ctx;
  const node = domNodes.get(nodeId);
  if (!node) return [];
  // Drop `node` and hand its children to `newParentId`, each on its own terms.
  const promote = () =>
    node.childIds.flatMap((childId) =>
      processNode(childId, newParentId, depth, ctx),
    );

  // Hidden by its own `visibility:hidden` only: the node goes, but a child that
  // sets `visibility:visible` is rendered, so walk on. Any other hiding
  // (`aria-hidden`) takes the whole subtree with it.
  if (!node.a11y.isExposedToAT) {
    // A hidden root has no parent to promote its children to.
    const element = newParentId && getElementRefs().get(node.id);
    return element && isHiddenOnlyByVisibility(element) ? promote() : [];
  }

  // See SUPPRESS_KEEP_INTERACTIVE.
  if (SUPPRESS_KEEP_INTERACTIVE.has(node.dom!.tagName)) {
    // A name source Chromium can focus is more than a name: the <summary>
    // that toggles its <details> is a tab stop. It stays as a node of its
    // own, or the tab sequence and a [focused] marker have nothing to point
    // at. Its text-only children go either way, since that text is its name.
    const keep = node.interaction!.isFocusable;
    const keptChildIds: string[] = [];
    for (const childId of node.childIds) {
      if (!hasInteractiveDescendant(childId, domNodes)) continue;
      keptChildIds.push(
        ...processNode(
          childId,
          keep ? node.id : newParentId,
          keep ? depth + 1 : depth,
          ctx,
        ),
      );
    }
    if (!keep) return keptChildIds;
    a11yNodes.set(node.id, {
      ...node,
      parentId: newParentId,
      childIds: keptChildIds,
      depth,
      ui: { ...node.ui!, expanded: depth < 3 },
    });
    return [node.id];
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
      const keptChildIds = processNode(childId, node.id, depth + 1, ctx);
      a11yNode.childIds.push(...keptChildIds);
    }

    a11yNodes.set(node.id, a11yNode);
    return [node.id];
  } else {
    // This node is flattened — promote its children to the parent
    return promote();
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
  processNode(rootId, null, 0, { domNodes, a11yNodes, rootId });

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
