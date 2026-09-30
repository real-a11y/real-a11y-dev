/**
 * `contenteditable`, resolved the way Chromium resolves it for focus.
 *
 * The attribute is enumerated: `""`, `"true"` and `"plaintext-only"` (in any
 * ASCII case) make an element editable, `"false"` makes it not, and any other
 * value — like no attribute at all — inherits from the parent. So an element
 * is editable when the nearest ancestor (itself included) whose attribute
 * decides says so.
 *
 * Editing stops at a shadow boundary: a link a component renders into its
 * shadow root stays focusable even when the component sits in an editor, so
 * the walk climbs `parentElement` and never crosses to a host. It reads that
 * clobber-safely, because a `<form>` whose control is named `parentElement`
 * would otherwise hand back the control, whose parent is the form again.
 *
 * `document.designMode` is not modelled. It makes the whole document one
 * editable region, where Chromium's Tab no longer leaves the body at all, so
 * no tab sequence can describe it.
 */

import { safeParentElement } from "./clobber-safe.js";

/** The keywords that make an element editable, lower-cased. */
const EDITABLE_KEYWORDS = new Set(["", "true", "plaintext-only"]);

/**
 * What `element`'s own `contenteditable` decides: `true` or `false`, or `null`
 * when it has none (or an invalid value) and inherits.
 */
function ownEditableState(element: Element): boolean | null {
  const value = element.getAttribute("contenteditable");
  if (value === null) return null;
  const keyword = value.toLowerCase();
  if (EDITABLE_KEYWORDS.has(keyword)) return true;
  return keyword === "false" ? false : null;
}

/** True when `element` is editable content, itself included. */
export function isEditable(element: Element): boolean {
  for (
    let node: Element | null = element;
    node;
    node = safeParentElement(node)
  ) {
    const state = ownEditableState(node);
    if (state !== null) return state;
  }
  return false;
}

/**
 * True for an editing host: an editable element whose parent is not — the
 * root of an editable region, such as a message composer. Chromium focuses
 * the host, so it is a tab stop without any `tabindex`; an editable element
 * nested inside it is not. A `contenteditable="true"` inside a
 * `contenteditable="false"` island is a host again.
 */
export function isEditingHost(element: Element): boolean {
  if (ownEditableState(element) !== true) return false;
  const parent = safeParentElement(element);
  return !parent || !isEditable(parent);
}
