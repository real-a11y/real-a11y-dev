/**
 * Which overlays outside the root the scan for one (`findPortalOverlay` in
 * `dom-extractor.ts`) leaves alone, rather than widen the tree to the whole
 * page for: one assistive technology can't reach, and anything in one of this
 * project's own panels, whose live region, where it says what changed, is
 * the panel's and no overlay of the page.
 */

import { isAriaHiddenValue } from "./aria-tokens.js";
import { safeGetAttribute, safeParentElement } from "./clobber-safe.js";

/**
 * Marks an element that hosts one of this project's own panels (the
 * inspector sets it on its `container`). The walk skips it and everything
 * under it: the panel mounts in an open shadow root, which the flat-tree walk
 * would otherwise read as page content — and in `mount: "light"` the panel's
 * UI was already in the light DOM.
 *
 * @internal Shared between `core` and this project's own panels. Both are
 * internal packages; no published surface re-exports it.
 */
export const PANEL_HOST_ATTRIBUTE = "data-real-a11y-panel";

/**
 * True when `element` or an ancestor is `inert`, is `aria-hidden` with a
 * value Chromium hides for, or hosts one of this project's panels. Not
 * `closest('[aria-hidden="true"]')`, which matches one spelling of it, and
 * not `closest('[aria-hidden]')`, which stops at an `aria-hidden="false"`
 * below the ancestor that hides.
 */
export function isOutOfReach(element: Element): boolean {
  for (let el: Element | null = element; el; el = safeParentElement(el)) {
    // Any ancestor can be a <form> holding `<input name="hasAttribute">`.
    if (safeGetAttribute(el, "inert") !== null) return true;
    if (isAriaHiddenValue(safeGetAttribute(el, "aria-hidden"))) return true;
    if (safeGetAttribute(el, PANEL_HOST_ATTRIBUTE) !== null) return true;
  }
  return false;
}
