/** The namespace of SVG 1.1's `xlink:href`, which SVG 2 replaced with `href`. */
const XLINK_NS = "http://www.w3.org/1999/xlink";

/**
 * Whether an `<a>` carries a link target: `href`, or the older `xlink:href`
 * an SVG `<a>` may still use. SVG-AAM maps an `a` with either to `link`, and
 * Chromium makes it focusable on either. Role, focusability and the actions
 * offered all ask this one question so they cannot drift apart.
 */
export function hasLinkHref(element: Element): boolean {
  return (
    element.hasAttribute("href") || element.hasAttributeNS(XLINK_NS, "href")
  );
}
