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
const hiddenGetter = htmlElementProto
  ? Object.getOwnPropertyDescriptor(htmlElementProto, "hidden")?.get
  : undefined;

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
