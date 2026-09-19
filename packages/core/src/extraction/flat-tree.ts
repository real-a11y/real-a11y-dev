/**
 * The FLAT tree: what the browser renders and what assistive tech reads.
 *
 * The light-DOM `children` of a shadow host are not what's on screen. A host
 * with an open shadow root renders its shadow tree instead, and each `<slot>`
 * in it renders the light-DOM nodes assigned to it (or its own fallback
 * content when nothing is assigned). Light children that no slot takes are not
 * rendered at all. Chromium builds its accessibility tree from this flat tree,
 * so an extractor that walks light DOM sees an empty `<skip-to-content>` where
 * the native tree has a button, and every web component (Lit, Shoelace,
 * design-system custom elements) extracts as a bare host.
 *
 * Closed shadow roots — including the UA ones behind `<video>` controls and
 * `<input>` internals — are unreachable from page script by design; their
 * hosts stay leaves, as before.
 */

import { safeChildNodes, safeHidden, safeShadowRoot } from "./clobber-safe.js";

const ELEMENT_NODE = 1;
const DOCUMENT_NODE = 9;
const DOCUMENT_FRAGMENT_NODE = 11;

function isSlot(node: Node): node is HTMLSlotElement {
  return (
    node.nodeType === ELEMENT_NODE &&
    (node as Element).localName === "slot" &&
    typeof (node as HTMLSlotElement).assignedNodes === "function"
  );
}

/**
 * A hidden slot renders nothing THROUGH it — `hidden`, `display:none` or
 * `aria-hidden` on the slot takes the whole distributed subtree with it,
 * wherever that content's own markup lives. The slot itself never becomes a
 * node (it is transparent), so the walk can't prune it later; this is the one
 * chance to drop the assignment. Deliberately a local read, not
 * `isSubtreeHidden`: `role-map` imports this module.
 */
function slotHidesItsAssignment(slot: HTMLSlotElement): boolean {
  if (safeHidden(slot) || slot.getAttribute("aria-hidden") === "true") {
    return true;
  }
  const style =
    typeof getComputedStyle === "function" ? getComputedStyle(slot) : null;
  return style?.display === "none" || style?.visibility === "hidden";
}

/**
 * Child nodes in the flat tree. A `<slot>` is transparent (it renders like
 * `display: contents`): it is replaced by its flattened assignment, which
 * already falls back to the slot's own children when nothing is assigned and
 * resolves slots nested through several hosts.
 */
export function flatChildNodes(node: Node): Node[] {
  const shadow =
    node.nodeType === ELEMENT_NODE ? safeShadowRoot(node as Element) : null;
  const out: Node[] = [];
  for (const child of safeChildNodes(shadow ?? node)) {
    if (isSlot(child)) {
      if (!slotHidesItsAssignment(child)) {
        out.push(...child.assignedNodes({ flatten: true }));
      }
    } else out.push(child);
  }
  return out;
}

/**
 * True if `element` is rendered at all: every shadow host above it actually
 * distributes it through a slot. A light child no slot takes is not rendered,
 * so it must not act as an IDREF referrer — folding a visible description
 * target for a reference nobody can reach loses page content.
 */
export function isRenderedInFlatTree(element: Element): boolean {
  let node: Element | null = element;
  while (node) {
    const parent: Element | null = node.parentElement;
    if (parent && safeShadowRoot(parent) && !node.assignedSlot) return false;
    if (parent) {
      node = parent;
      continue;
    }
    const root: Node = node.getRootNode();
    node =
      root.nodeType === DOCUMENT_FRAGMENT_NODE
        ? ((root as ShadowRoot).host ?? null)
        : null;
  }
  return true;
}

/** Element children in the flat tree. */
export function flatChildren(element: Element): Element[] {
  return flatChildNodes(element).filter(
    (n): n is Element => n.nodeType === ELEMENT_NODE,
  );
}

/**
 * Parent in the flat tree: the slot a node is assigned to (skipped, since
 * slots are transparent), else the light parent, else — at the top of a
 * shadow tree — the host.
 */
export function flatParent(element: Element): Element | null {
  // A slotted node's parent is its slot's parent; a forwarded slot recurses.
  const slot = element.assignedSlot;
  if (slot) return flatParent(slot);
  const parent =
    element.parentElement ??
    (element.parentNode?.nodeType === DOCUMENT_FRAGMENT_NODE
      ? (element.parentNode as ShadowRoot).host
      : null) ??
    null;
  // Slot fallback content: skip the transparent slot.
  return parent && isSlot(parent) ? flatParent(parent) : parent;
}

/**
 * The node IDREFs resolve against. `aria-labelledby`, `aria-describedby` and
 * `label[for]` are scoped to the element's own tree, so inside a shadow root
 * they must look in that root, not the document. A detached subtree has no
 * scope and falls back to its owner document, as before.
 */
export function idScope(element: Element): Document | ShadowRoot {
  const root = element.getRootNode();
  return root.nodeType === DOCUMENT_NODE ||
    root.nodeType === DOCUMENT_FRAGMENT_NODE
    ? (root as Document | ShadowRoot)
    : element.ownerDocument;
}

/**
 * `querySelectorAll` that also searches every open shadow root under `root`.
 * Used for the extraction-wide IDREF pre-pass, which has to see references
 * made from inside components. Like `querySelectorAll`, `root` itself is not
 * a candidate — only its descendants, light and shadow.
 */
export function deepQuerySelectorAll(
  root: Element,
  selector: string,
): Element[] {
  const out: Element[] = [];
  const visit = (scope: Element | ShadowRoot): void => {
    out.push(...scope.querySelectorAll(selector));
    for (const el of scope.querySelectorAll("*")) {
      const shadow = safeShadowRoot(el);
      if (shadow) visit(shadow);
    }
  };
  const own = safeShadowRoot(root);
  if (own) visit(own);
  visit(root);
  return out;
}
