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
 *
 * Two closed UA roots still have to be modelled, because they decide what
 * renders: a `<details>`' (see {@link isClosedDetails}) and a `<textarea>`'s
 * (see {@link isTextarea}).
 */

import { isAriaHiddenValue } from "./aria-tokens.js";
import {
  safeAssignedSlot,
  safeChildNodes,
  safeChildren,
  safeHidden,
  safeOwnerDocument,
  safeParentElement,
  safeParentNode,
  safeQuerySelectorAll,
  safeRootNode,
  safeShadowRoot,
} from "./clobber-safe.js";

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
 * A hidden slot renders nothing THROUGH it — the whole distributed subtree
 * goes with it, wherever that content's own markup lives. The slot never
 * becomes a node of its own (it is transparent), so the walk cannot prune it
 * later; this is the one chance to drop the assignment.
 *
 * The conditions mirror `isSubtreeHidden` (plus `aria-hidden`, which the walk
 * applies separately) and they matter in both directions:
 *
 * - **`visibility:hidden` is NOT here**, for the same reason `isSubtreeHidden`
 *   omits it: visibility is inherited but not subtree-hiding, so an assigned
 *   child may set `visibility:visible` and render after all. Real browsers
 *   inherit through the flat tree, so a child that doesn't override it is
 *   hidden by its own computed style anyway.
 * - **`inert` IS here.** It hides its flat-tree subtree from AT and from the
 *   keyboard, and skipping the slot removes the only ancestor where the walk
 *   would have seen it.
 *
 * Duplicated rather than calling `isSubtreeHidden`, because `role-map`
 * imports this module — keep the two in step.
 */
function slotHidesItsAssignment(slot: HTMLSlotElement): boolean {
  if (
    safeHidden(slot) ||
    slot.hasAttribute("inert") ||
    isAriaHiddenValue(slot.getAttribute("aria-hidden"))
  ) {
    return true;
  }
  const style =
    typeof getComputedStyle === "function" ? getComputedStyle(slot) : null;
  return style?.display === "none" || style?.contentVisibility === "hidden";
}

/**
 * A `<details>`' summary: its first `<summary>` child, even with other content
 * before it. A DOM child, not a flat-tree one, so a light-DOM summary slotted
 * into a shadow `<details>` is body like anything else slotted there, and
 * Chromium renders its default "Details" summary instead. A loop over the
 * children rather than `:scope > summary`, which jsdom's selector engine
 * misses inside a shadow root.
 */
function detailsSummary(details: Element): Element | null {
  for (const child of safeChildren(details)) {
    if (child.localName === "summary") return child;
  }
  return null;
}

/**
 * True if `node` is a closed `<details>`, which renders its summary alone. Its
 * UA shadow root has one slot for the summary and one for everything else, and
 * the second hides its assignment until the details opens: a hidden slot, like
 * those {@link slotHidesItsAssignment} drops, except that the slot is out of
 * reach and nothing on the body's own nodes says it is hidden. Chromium leaves
 * that body out of its accessibility tree, and Tab never reaches a control in
 * it.
 *
 * `open` decides, whatever the details' role: `role="none"` changes what it is,
 * not what renders. An author stylesheet can show a closed body through
 * `::details-content`, but no attribute changes when it does, so a live tree
 * could not follow it; this goes by `open`, which a MutationObserver sees.
 */
function isClosedDetails(node: Node): boolean {
  return (
    node.nodeType === ELEMENT_NODE &&
    (node as Element).localName === "details" &&
    (node as HTMLDetailsElement).open === false
  );
}

/**
 * True if `node` is a `<textarea>`, which renders none of its children. Its UA
 * shadow root shows the field's current value and slots nothing, so its child
 * text — the markup DEFAULT value — is not page text: it goes stale once the
 * user types, and for a sensitive field (ADR-0001) it is the secret itself.
 * Chromium's accessibility tree has no node for it. The value reaches the tree
 * through `a11y.value` alone, classified first; no text walk may find it here.
 */
function isTextarea(node: Node): boolean {
  return (
    node.nodeType === ELEMENT_NODE && (node as Element).localName === "textarea"
  );
}

/**
 * Child nodes in the flat tree. A `<slot>` is transparent (it renders like
 * `display: contents`): it is replaced by its flattened assignment, which
 * already falls back to the slot's own children when nothing is assigned and
 * resolves slots nested through several hosts. A closed `<details>` has only
 * its summary (see {@link isClosedDetails}), and a `<textarea>` has none (see
 * {@link isTextarea}).
 */
export function flatChildNodes(node: Node): Node[] {
  if (isTextarea(node)) return [];
  if (isClosedDetails(node)) {
    const summary = detailsSummary(node as Element);
    return summary ? [summary] : [];
  }
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
 * distributes it through a slot, no closed `<details>` above it holds it in its
 * body, and no `<textarea>` holds it at all (only script can put one there).
 * An unrendered element must not act as an IDREF referrer — folding a
 * visible description target for a reference nobody can reach loses page
 * content.
 *
 * Climbs through the slot a node is assigned to, not straight to its host, so
 * a `<details>` in the shadow tree around that slot counts too. Every read on
 * the way up is clobber-safe: a `<form>` holding `<input name="parentElement">`
 * would otherwise send the climb round the form and that input forever.
 */
export function isRenderedInFlatTree(element: Element): boolean {
  let node: Element | null = element;
  while (node) {
    const parent: Element | null = safeParentElement(node);
    if (parent && safeShadowRoot(parent)) {
      node = safeAssignedSlot(node);
      if (!node) return false;
      continue;
    }
    if (parent) {
      if (isClosedDetails(parent) && detailsSummary(parent) !== node) {
        return false;
      }
      if (isTextarea(parent)) return false;
      node = parent;
      continue;
    }
    const root: Node = safeRootNode(node);
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
 *
 * Each read is clobber-safe: through a `<form>` whose control is named
 * `parentElement` or `assignedSlot`, a plain read cycles back to the form, and
 * every loop over ancestors would spin forever. One named `parentNode` would
 * end the climb at the top of a shadow root instead, short of the host.
 */
export function flatParent(element: Element): Element | null {
  // A slotted node's parent is its slot's parent; a forwarded slot recurses.
  const slot = safeAssignedSlot(element);
  if (slot) return flatParent(slot);
  const parent = safeParentElement(element) ?? shadowHostAbove(element);
  // Slot fallback content: skip the transparent slot.
  return parent && isSlot(parent) ? flatParent(parent) : parent;
}

/** The host of the shadow root `element` sits directly in, if it does. */
function shadowHostAbove(element: Element): Element | null {
  const parentNode = safeParentNode(element);
  return parentNode?.nodeType === DOCUMENT_FRAGMENT_NODE
    ? ((parentNode as ShadowRoot).host ?? null)
    : null;
}

/**
 * The element that renders `element`: the slot it is assigned to, else its
 * parent, else the host of its shadow root. Unlike {@link flatParent}, this
 * stops at slots, because a hidden slot hides everything it renders: a climb
 * asking whether an element is rendered has to see them.
 */
export function renderingParent(element: Element): Element | null {
  const slot = safeAssignedSlot(element);
  if (slot) return slot;
  const parentNode = safeParentNode(element);
  return (
    safeParentElement(element) ??
    (parentNode?.nodeType === DOCUMENT_FRAGMENT_NODE
      ? (parentNode as ShadowRoot).host
      : null)
  );
}

/**
 * The node IDREFs resolve against. `aria-labelledby`, `aria-describedby` and
 * `label[for]` are scoped to the element's own tree, so inside a shadow root
 * they must look in that root, not the document. A detached subtree has no
 * scope and falls back to its owner document, as before.
 *
 * The root is read clobber-safely: on a `<form>` holding
 * `<input name="getRootNode">` the method is that input, so calling it throws
 * and the labelled form is dropped from the tree with everything inside it.
 *
 * `root.nodeType` needs no clobber-safe read: a shadowed one reads as an
 * element, matching neither, and the fallback is then right for a detached
 * form root and for a document whose `<img name="nodeType">` shadows it alike.
 */
export function idScope(element: Element): Document | ShadowRoot {
  const root = safeRootNode(element);
  return root.nodeType === DOCUMENT_NODE ||
    root.nodeType === DOCUMENT_FRAGMENT_NODE
    ? (root as Document | ShadowRoot)
    : safeOwnerDocument(element);
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
    out.push(...safeQuerySelectorAll(scope, selector));
    for (const el of safeQuerySelectorAll(scope, "*")) {
      const shadow = safeShadowRoot(el);
      if (shadow) visit(shadow);
    }
  };
  const own = safeShadowRoot(root);
  if (own) visit(own);
  visit(root);
  return out;
}
