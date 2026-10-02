/**
 * Image maps: which image an `<area>` belongs to, the way Chromium decides it.
 *
 * An area has no box of its own. Chromium's UA stylesheet rendered one inline
 * up to 151 and gives it `display: none` since 153, and neither decides
 * anything: Chromium focuses an area, and its accessibility tree exposes one,
 * while the image using its map is rendered (`HTMLAreaElement::
 * IsFocusableStyle` reads the image's layout object, never the area's). So
 * the walk emits an area, at its own place in the document, exactly while that
 * image is rendered. That place is also where Chromium tabs to it, wherever
 * the image is. See `isSubtreeHidden` in role-map.ts.
 *
 * Chromium's accessibility tree puts an area under its image instead, which
 * is why an area adds nothing to the name of the element its map sits in, and
 * is hidden from AT when its image is.
 */

import {
  safeOwnerDocument,
  safeQuerySelectorAll,
  safeRootNode,
} from "./clobber-safe.js";

/**
 * The image an area belongs to, or `null`: the first `<img>` in the document
 * whose `usemap` is `#` and the name or id of the area's `<map>`, matched
 * case-sensitively. Only the first counts: when it is not rendered, a later
 * image using the same map doesn't give its areas back.
 *
 * Chromium searches the document's images, which leave out every shadow tree:
 * an image inside a shadow root gives a map's areas nothing, while a map
 * inside one still takes its image from the document. A detached subtree has
 * no document to search, so it searches itself. The search is clobber-safe:
 * `<img name="querySelectorAll">` shadows the document's own.
 */
export function imageUsingMap(area: Element): Element | null {
  const map = area.closest("map");
  if (!map) return null;
  const names = [map.getAttribute("name"), map.getAttribute("id")];
  const scope: ParentNode = area.isConnected
    ? safeOwnerDocument(area)
    : (safeRootNode(area) as ParentNode);
  for (const img of safeQuerySelectorAll(scope, "img[usemap]")) {
    const usemap = img.getAttribute("usemap") ?? "";
    if (usemap.startsWith("#") && names.includes(usemap.slice(1))) return img;
  }
  return null;
}
