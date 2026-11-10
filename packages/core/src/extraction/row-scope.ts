/**
 * Which rows of a read are of the page a root holds, for the change marks of
 * a panel given that root (`semantic-tree-diff.ts` in the shared panel; the
 * Storybook addon's preview sends what it finds to its panel).
 *
 * The DOM producer names a node after its element for as long as the element
 * lasts (`getNodeId`), so every id lasts from one read to the next. But a read
 * widened to the whole page, for a toast or a menu mounted outside the root
 * (`resolveEffectiveRoot`), brings the page around the root, which the page
 * didn't add, and takes it away again when the overlay goes.
 */

import { getElementRefs } from "./dom-extractor.js";
import { isOverlaySignal } from "./overlay-scope.js";

/** Which rows of a read are of the page a root holds. */
export interface RowScope {
  /**
   * Whether row `id` is one of the page's: inside the root, or inside an
   * overlay outside it. Not the root's own row, which a read widened to the
   * whole page flattens away, nor the rest of the page such a read brings.
   */
  has(id: string): boolean;
  /** Whether row `id` is the root's own. */
  isRoot(id: string): boolean;
}

/** `Node.prototype`'s own getter for `name`, read when first asked: a
 *  page's `<form>` can shadow `parentNode` or `isConnected` with a control
 *  of that name. */
function nodeGetter<T>(name: "parentNode" | "isConnected") {
  return Object.getOwnPropertyDescriptor(Node.prototype, name)!.get as (
    this: Node,
  ) => T;
}
let parentNodeOf: ((this: Node) => Node | null) | undefined;
let isConnectedOf: ((this: Node) => boolean) | undefined;

/** `node`'s parent, out of a shadow tree to its host. */
function composedParent(node: Node): Node | null {
  parentNodeOf ??= nodeGetter<Node | null>("parentNode");
  const parent = parentNodeOf.call(node);
  if (parent) return parent;
  return node instanceof ShadowRoot ? node.host : null;
}

/** Whether `el`, on the page, is one of the page `root` holds. The rows
 *  inside the root, nearly all of them, settle on the way up to it. */
function scopeOf(root: Element, el: Element): boolean {
  if (el === root) return false;
  for (let n: Node | null = el; n; n = composedParent(n)) {
    if (n === root) return true;
  }
  let overlay: Element | null = null;
  for (let n: Node | null = el; n && !overlay; n = composedParent(n)) {
    if (n instanceof Element && isOverlaySignal(n)) overlay = n;
  }
  if (!overlay) return false;
  // A live region around the whole app, as a router's announcer can be, is
  // no overlay of its own.
  for (let n: Node | null = root; n; n = composedParent(n)) {
    if (n === overlay) return false;
  }
  return true;
}

/**
 * The rows of the page `root` holds, by the elements this realm's reads named
 * them after: an element inside it, shadow trees included, or inside an
 * overlay outside it (`isOverlaySignal`). An element no longer on the page
 * answers as it did while it was; one never seen there can't tell, and is
 * one, as is a row with no element.
 */
export function rootRowScope(root: Element): RowScope {
  const seen = new WeakMap<Element, boolean>();
  return {
    has(id) {
      const el = getElementRefs().get(id);
      if (!el) return true;
      isConnectedOf ??= nodeGetter<boolean>("isConnected");
      if (!isConnectedOf.call(el)) return seen.get(el) ?? true;
      const on = scopeOf(root, el);
      seen.set(el, on);
      return on;
    },
    isRoot: (id) => getElementRefs().get(id) === root,
  };
}
