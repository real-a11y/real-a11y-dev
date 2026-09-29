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
 * `element.getAttribute("id")`, which a control named `id` cannot reach and
 * which reads more naturally at the use site. A control named `getAttribute`
 * can reach it, as a control named after any method can: see "Methods" below.
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
const getRootNodeMethod = nodeProto?.getRootNode;

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

/**
 * Clobber-immune `node.parentElement`. A climb that reads it plainly never
 * ends on a `<form>` holding `<input name="parentElement">`: the form's parent
 * is the input, whose parent is the form again.
 */
export function safeParentElement(node: Node): Element | null {
  const parent = parentElementGetter
    ? parentElementGetter.call(node)
    : node.parentElement;
  return parent && parent.nodeType === 1 ? (parent as Element) : null;
}

/** Clobber-immune `node.parentNode`. See `safeParentElement`. */
export function safeParentNode(node: Node): ParentNode | null {
  return parentNodeGetter
    ? (parentNodeGetter.call(node) as ParentNode | null)
    : node.parentNode;
}

/** Clobber-immune `element.assignedSlot` (`<input name="assignedSlot">`). */
export function safeAssignedSlot(element: Element): HTMLSlotElement | null {
  const slot = assignedSlotGetter
    ? assignedSlotGetter.call(element)
    : element.assignedSlot;
  return slot && slot.nodeType === 1 ? (slot as HTMLSlotElement) : null;
}

/** Clobber-immune `node.getRootNode()` (`<input name="getRootNode">`). */
export function safeRootNode(node: Node): Node {
  return getRootNodeMethod ? getRootNodeMethod.call(node) : node.getRootNode();
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

/*
 * Methods
 *
 * `[LegacyOverrideBuiltIns]` shadows methods as readily as accessors, and
 * `Document` has it as well as `<form>`: a named `<img>`, `<form>`, `<embed>`
 * or `<object>` shadows the document member of the same name. So
 * `<input name="getAttribute">` makes `form.getAttribute(…)` throw, and
 * `<img name="getElementById">` makes `document.getElementById(…)` throw.
 *
 * Not every call goes through these. A throw on one element costs that element
 * — the walk's per-element boundary skips it, and `LiveTreeExtractor.refresh`
 * falls back to a full extraction — which is the right price for a form that
 * names its controls after DOM methods. These are for the reads that cost more
 * than the element they were made on: the document every id lookup runs
 * against, the extraction root, and the observer's per-mutation filter. A
 * throw there drops every labelled control on the page, aborts the whole
 * extraction, or loses a whole batch of mutations.
 */

const documentProto =
  typeof Document !== "undefined" ? Document.prototype : null;
const fragmentProto =
  typeof DocumentFragment !== "undefined" ? DocumentFragment.prototype : null;

const nodeTypeGetter = nodeProto
  ? Object.getOwnPropertyDescriptor(nodeProto, "nodeType")?.get
  : undefined;
const ownerDocumentGetter = nodeProto
  ? Object.getOwnPropertyDescriptor(nodeProto, "ownerDocument")?.get
  : undefined;
const getAttributeMethod = elementProto?.getAttribute;
const containsMethod = nodeProto?.contains;

/**
 * `querySelector`, `querySelectorAll` and `getElementById` are defined once per
 * interface — `Element`, `Document`, and `DocumentFragment` (which `ShadowRoot`
 * inherits) — and each brand-checks its receiver, so the captured function has
 * to be the one for the kind of node it is called on. Keyed by `nodeType`.
 */
interface ScopeMethods {
  querySelector: ParentNode["querySelector"];
  querySelectorAll: ParentNode["querySelectorAll"];
  getElementById?: NonElementParentNode["getElementById"];
}
const scopeMethodsOf = (
  proto: (ParentNode & Partial<NonElementParentNode>) | null,
): ScopeMethods | undefined =>
  proto
    ? {
        querySelector: proto.querySelector,
        querySelectorAll: proto.querySelectorAll,
        getElementById: proto.getElementById,
      }
    : undefined;
const SCOPE_METHODS: Record<number, ScopeMethods | undefined> = {
  1: scopeMethodsOf(elementProto),
  9: scopeMethodsOf(documentProto),
  11: scopeMethodsOf(fragmentProto),
};

function scopeMethods(node: Node): ScopeMethods | undefined {
  return SCOPE_METHODS[
    nodeTypeGetter ? (nodeTypeGetter.call(node) as number) : node.nodeType
  ];
}

/** Clobber-immune `element.getAttribute(name)` (`<input name="getAttribute">`). */
export function safeGetAttribute(
  element: Element,
  name: string,
): string | null {
  return getAttributeMethod
    ? getAttributeMethod.call(element, name)
    : element.getAttribute(name);
}

/** Clobber-immune `node.contains(other)` (`<img name="contains">`). */
export function safeContains(node: Node, other: Node | null): boolean {
  return containsMethod
    ? containsMethod.call(node, other)
    : node.contains(other);
}

/**
 * Clobber-immune `element.ownerDocument` (`<input name="ownerDocument">`),
 * which is what an element in a detached subtree resolves its ids against.
 */
export function safeOwnerDocument(element: Element): Document {
  return ownerDocumentGetter
    ? (ownerDocumentGetter.call(element) as Document)
    : element.ownerDocument;
}

/** Clobber-immune `scope.querySelector(selectors)`, on an element, document or shadow root. */
export function safeQuerySelector(
  scope: ParentNode,
  selectors: string,
): Element | null {
  const own = scopeMethods(scope)?.querySelector;
  return own ? own.call(scope, selectors) : scope.querySelector(selectors);
}

/** Clobber-immune `scope.querySelectorAll(selectors)`. See `safeQuerySelector`. */
export function safeQuerySelectorAll(
  scope: ParentNode,
  selectors: string,
): NodeListOf<Element> {
  const own = scopeMethods(scope)?.querySelectorAll;
  return own ? own.call(scope, selectors) : scope.querySelectorAll(selectors);
}

/**
 * Clobber-immune `scope.getElementById(id)`, on a document or shadow root —
 * the lookup behind every `aria-labelledby` and `aria-describedby`.
 */
export function safeGetElementById(
  scope: Document | DocumentFragment,
  id: string,
): Element | null {
  const own = scopeMethods(scope)?.getElementById;
  return own ? own.call(scope, id) : scope.getElementById(id);
}
