/** Which roles take an authored `aria-expanded`, `aria-selected` or `aria-checked`. */

import { canExpand } from "./expanded-roles.js";

export { canExpand };

/**
 * The roles Chromium 153 gives a selected state, measured on a `<div>` in
 * every ARIA role, in its required context where it has one. They are the
 * roles WAI-ARIA 1.2 §6.2.2 lists as using `aria-selected`, plus the ones it
 * inherits into. Any other role has none in their tree, whatever sets one.
 *
 * `cell` is allowed on purpose. A `<td>` in a grid is a `cell` here and a
 * `gridcell` in Chromium, which does give it the state, and the two cannot be
 * told apart until that role is fixed. A `<td>` in a plain table keeps a state
 * Chromium drops until then.
 */
const SELECTABLE_ROLES = new Set([
  "cell",
  "columnheader",
  "gridcell",
  "option",
  "row",
  "rowheader",
  "tab",
  "treeitem",
]);

/**
 * The roles Chromium 153 gives a checked state, measured the same way. The
 * same roles WAI-ARIA 1.2 §6.2.2 lists for `aria-checked`, and those it
 * inherits into.
 */
const CHECKABLE_ROLES = new Set([
  "checkbox",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "switch",
  "treeitem",
]);

/**
 * Whether an element whose computed role is `role` can report the state
 * `attr` sets. Only the three attributes with a role gate are limited.
 */
export function roleTakesState(
  element: Element,
  attr: string,
  role: string,
): boolean {
  if (attr === "aria-expanded") return canExpand(element, role);
  if (attr === "aria-selected") return SELECTABLE_ROLES.has(role);
  if (attr === "aria-checked") return CHECKABLE_ROLES.has(role);
  return true;
}
