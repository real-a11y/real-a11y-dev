import { isAriaHiddenValue } from "./aria-tokens.js";
import { flatChildren } from "./flat-tree.js";
import {
  getCachedComputedStyle,
  isHiddenFromAT,
  isSubtreeHidden,
  type StyleCache,
} from "./role-map.js";

/**
 * Whether an element is hidden from AT by its own `visibility:hidden` and for
 * no other reason. Unlike `aria-hidden`, `display:none` or `inert`, that hides
 * the element alone: a descendant can set `visibility:visible` and be
 * rendered, so the a11y projection drops the node but keeps walking its
 * children.
 *
 * Elements the UA hides outright (`head`, `script`, `area` and the like) are
 * `display:none`, which {@link isSubtreeHidden} already covers.
 */
export function isHiddenOnlyByVisibility(
  element: Element,
  style?: CSSStyleDeclaration | null,
): boolean {
  if (isAriaHiddenValue(element.getAttribute("aria-hidden"))) return false;
  // A media element's children are unrendered fallback, never reachable.
  if (element.localName === "video" || element.localName === "audio") {
    return false;
  }
  const computed =
    style !== undefined ? style : getCachedComputedStyle(element);
  // No computed style (a DOM-less runtime): the inline value, as isHiddenFromAT.
  const visibility = computed
    ? computed.visibility
    : (element as HTMLElement).style?.visibility;
  return visibility === "hidden" && !isSubtreeHidden(element, computed);
}

/**
 * The children of `element` a user could reach, looking through any child
 * hidden by its own `visibility:hidden`: that child is not reachable, but a
 * descendant that sets `visibility:visible` is. Children hidden any other way
 * (`aria-hidden`, `display:none`, `inert`) take their subtree with them.
 */
export function reachableChildren(
  element: Element,
  styleCache: StyleCache,
): Element[] {
  return flatChildren(element).flatMap((child) => {
    const style = getCachedComputedStyle(child, styleCache);
    if (!isHiddenFromAT(child, style)) return [child];
    return isHiddenOnlyByVisibility(child, style)
      ? reachableChildren(child, styleCache)
      : [];
  });
}
