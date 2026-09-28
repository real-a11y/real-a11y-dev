/**
 * Clobber-immune DOM reads.
 *
 * `<form>` is the one HTML element with `[LegacyOverrideBuiltIns]`: a listed
 * control whose `name`/`id` matches a DOM property name shadows that property,
 * so reading it returns the child ELEMENT instead of the real value. On a form
 * with `<input name="id">` (ubiquitous — hidden record-id fields) `form.id` is
 * the input; `<input name="children">` (e.g. a "number of children" field)
 * makes `form.children` the input; and `<input name="hidden">` /
 * `<input id="hidden">` makes `form.hidden` the input — a truthy value that
 * would silently drop the whole `<form>` subtree from the tree.
 *
 * The extraction walk has no per-element error boundary in older code paths, so
 * a string/iteration method called on such a value throws and the ENTIRE
 * extraction aborts (the panel hangs on "Connecting to page…"). These helpers
 * read the affected props through the native prototype accessors, captured once
 * at module load. A per-element named getter cannot override a reference we
 * already hold, so `getter.call(element)` always yields the real value.
 *
 * `id` is intentionally NOT wrapped here — callers read it via
 * `element.getAttribute("id")`, which is immune to the same clobbering and
 * reads more naturally at the use site.
 */

const elementProto = typeof Element !== "undefined" ? Element.prototype : null;
const nodeProto = typeof Node !== "undefined" ? Node.prototype : null;
const htmlElementProto =
  typeof HTMLElement !== "undefined" ? HTMLElement.prototype : null;

const childrenGetter = elementProto
  ? Object.getOwnPropertyDescriptor(elementProto, "children")?.get
  : undefined;
const childNodesGetter = nodeProto
  ? Object.getOwnPropertyDescriptor(nodeProto, "childNodes")?.get
  : undefined;
const textContentGetter = nodeProto
  ? Object.getOwnPropertyDescriptor(nodeProto, "textContent")?.get
  : undefined;
const shadowRootGetter = elementProto
  ? Object.getOwnPropertyDescriptor(elementProto, "shadowRoot")?.get
  : undefined;
const hiddenGetter = htmlElementProto
  ? Object.getOwnPropertyDescriptor(htmlElementProto, "hidden")?.get
  : undefined;
const parentElementGetter = nodeProto
  ? Object.getOwnPropertyDescriptor(nodeProto, "parentElement")?.get
  : undefined;
const parentNodeGetter = nodeProto
  ? Object.getOwnPropertyDescriptor(nodeProto, "parentNode")?.get
  : undefined;
const assignedSlotGetter = elementProto
  ? Object.getOwnPropertyDescriptor(elementProto, "assignedSlot")?.get
  : undefined;

/**
 * Clobber-immune `element.parentElement`, `.parentNode` and `.assignedSlot`.
 *
 * A walk UP the tree is where clobbering does the most harm: `<input
 * name="parentElement">` makes a form's parent read as its own child, and
 * `<input name="assignedSlot">` makes it read as a slot whose parent is the
 * form again. Either way a loop over ancestors cycles forever and hangs the
 * page, rather than throwing.
 */
export function safeParentElement(node: Node): Element | null {
  return parentElementGetter
    ? (parentElementGetter.call(node) as Element | null)
    : node.parentElement;
}

/** Clobber-immune `node.parentNode`. See `safeParentElement`. */
export function safeParentNode(node: Node): ParentNode | null {
  return parentNodeGetter
    ? (parentNodeGetter.call(node) as ParentNode | null)
    : node.parentNode;
}

/** Clobber-immune `element.assignedSlot`. See `safeParentElement`. */
export function safeAssignedSlot(element: Element): HTMLSlotElement | null {
  return assignedSlotGetter
    ? (assignedSlotGetter.call(element) as HTMLSlotElement | null)
    : element.assignedSlot;
}

/** Clobber-immune `element.children` (always an array of the real children). */
export function safeChildren(element: Element): Element[] {
  const kids = childrenGetter
    ? (childrenGetter.call(element) as HTMLCollection)
    : element.children;
  return Array.from(kids);
}

/** Clobber-immune `node.childNodes`. */
export function safeChildNodes(node: Node): ChildNode[] {
  const kids = childNodesGetter
    ? (childNodesGetter.call(node) as NodeListOf<ChildNode>)
    : node.childNodes;
  return Array.from(kids);
}

/**
 * Clobber-immune `element.shadowRoot` — the OPEN shadow root, or null (a
 * closed root is unreachable by design). `<input name="shadowRoot">` in a
 * `<form>` would otherwise hand back the input.
 */
export function safeShadowRoot(element: Element): ShadowRoot | null {
  const root = shadowRootGetter
    ? shadowRootGetter.call(element)
    : element.shadowRoot;
  return root && root.nodeType === 11 ? (root as ShadowRoot) : null;
}

/** Clobber-immune `node.textContent`, coerced to a string. */
export function safeTextContent(node: Node): string {
  const text = textContentGetter
    ? textContentGetter.call(node)
    : node.textContent;
  return typeof text === "string" ? text : "";
}

/**
 * Clobber-immune read of an element's `hidden` state as a boolean.
 *
 * The plain `element.hidden` property is a plausible clobbering target: a
 * `<form>` with `<input name="hidden">` (or `id="hidden"`) makes `form.hidden`
 * return that input — a truthy element — so a naive `if (element.hidden)` would
 * treat the form as hidden and drop its entire subtree. Reading through the
 * captured `HTMLElement.prototype` getter bypasses the shadowing own-property
 * and yields the element's real hidden state.
 *
 * Using the prototype getter (rather than `hasAttribute("hidden")`) preserves
 * the exact semantics of the property — including `hidden="until-found"` — and
 * is itself un-clobberable, whereas `element.hasAttribute` can be shadowed by a
 * control named `hasAttribute`.
 *
 * The getter brand-checks its receiver, so on a non-HTMLElement (SVG, MathML)
 * it throws; those elements have no `hidden` IDL attribute and read `undefined`
 * today, so we mirror that by reporting `false`.
 */
export function safeHidden(element: Element): boolean {
  if (hiddenGetter) {
    try {
      return !!hiddenGetter.call(element);
    } catch {
      // Non-HTMLElement receiver (SVG/MathML): no `hidden` IDL attribute.
      return false;
    }
  }
  // No HTMLElement.prototype getter available (non-DOM environment).
  return element.hasAttribute("hidden");
}
