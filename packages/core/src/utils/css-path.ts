/**
 * The locator algorithm, once — shared by both producers.
 *
 * A finding is only actionable if it says *where*. The DOM producer computes
 * that from a live `Element`; the native producer has no live element (it runs
 * in Node, over a CDP snapshot of the document), so it walks a different node
 * shape entirely. The rule for what a locator looks like is the same either
 * way, and it is fiddly enough — id shortcuts, `nth-of-type` disambiguation, a
 * depth cap — that two copies would drift.
 *
 * So the traversal is expressed once against a {@link CssPathAdapter}, and each
 * producer supplies the four accessors for its own node type.
 */

/** Valid enough to use as a bare `#id` selector without escaping. */
export const isValidCssId = (value: string | null | undefined): boolean =>
  typeof value === "string" && /^[A-Za-z][\w-]*$/.test(value);

/** How to read one node's shape, whatever "node" means to the caller. */
export interface CssPathAdapter<T> {
  /** Lowercased tag name. */
  tagName(node: T): string;
  /** Raw `id` attribute, or null. */
  id(node: T): string | null;
  /** Parent element, or null at the top. */
  parent(node: T): T | null;
  /** Element children of `node`, in document order (no text nodes). */
  children(node: T): T[];
  /**
   * True where the path must stop — the node is a boundary, never a segment.
   * The document element for both producers; also a shadow root or the document
   * itself for the native producer, whose walk sees node kinds a CSS path can't
   * cross. Stopping yields a partial path, which is honest; emitting the
   * boundary would yield a selector that matches nothing.
   */
  isRoot(node: T): boolean;
}

/** How many ancestor segments a path may carry before it stops being useful. */
const MAX_DEPTH = 6;

/**
 * Best-effort unique-ish CSS path: prefer an id, else an `nth-of-type` chain,
 * anchored on the nearest ancestor id if one turns up on the way out.
 */
export function buildCssPath<T>(node: T, dom: CssPathAdapter<T>): string {
  const ownId = dom.id(node);
  if (isValidCssId(ownId)) return `#${ownId}`;

  const parts: string[] = [];
  let cur: T | null = node;
  for (let depth = 0; cur && !dom.isRoot(cur) && depth < MAX_DEPTH; depth++) {
    const current: T = cur;
    const tag = dom.tagName(current);
    const parent = dom.parent(current);
    if (!parent) {
      parts.unshift(tag);
      break;
    }
    const sameTag = dom
      .children(parent)
      .filter((child) => dom.tagName(child) === tag);
    parts.unshift(
      sameTag.length > 1
        ? `${tag}:nth-of-type(${sameTag.indexOf(current) + 1})`
        : tag,
    );
    // An ancestor id anchors the path and ends the walk early — shorter and
    // more stable than continuing to the document element.
    const parentId = dom.id(parent);
    if (isValidCssId(parentId)) {
      parts.unshift(`#${parentId}`);
      return parts.join(" > ");
    }
    cur = parent;
  }
  return parts.join(" > ");
}

/** Adapter for live DOM elements — what the in-page producer walks. */
export const DOM_ELEMENT_ADAPTER: CssPathAdapter<Element> = {
  tagName: (el) => el.tagName.toLowerCase(),
  id: (el) => el.getAttribute("id"),
  parent: (el) => el.parentElement,
  children: (el) => Array.from(el.children),
  isRoot: (el) => el === el.ownerDocument?.documentElement,
};
