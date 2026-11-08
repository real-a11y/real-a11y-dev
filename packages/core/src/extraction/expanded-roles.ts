/** Which roles carry an expanded state, and on which elements. */

import { isImplicitGridCell } from "./table-roles.js";

/**
 * The roles Chromium 151 gives an expanded state, measured on a `<button>`
 * across every ARIA role and in context. Chromium 153 agrees, and so does a
 * `<div>` in each role. Any other role has none in their tree, whatever sets
 * one: `aria-expanded`, a popover, or a `<details>`' `open`.
 *
 * `SUMMARY_EXPANDED_ROLES` in dom-extractor also has `form`, `option` and `region`. A
 * button in one of those reports the state only out of context, where Chromium
 * makes it a plain button: an option outside a list box, a region or form with
 * no name. In context it has none.
 *
 * Keyed on the role this engine computes. Where that differs from Chromium's,
 * the state follows the role it disagrees on. A `<td>` in a grid is a
 * `gridcell` in both, yet Chromium gives that implicit one no expanded state —
 * only an authored `role="gridcell"` gets one, which `isImplicitGridCell` tells apart.
 */
const EXPANDABLE_ROLES = new Set([
  "application",
  "button",
  "checkbox",
  "columnheader",
  "combobox",
  "gridcell",
  "link",
  "listitem",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "row",
  "rowheader",
  "switch",
  "tab",
  "treeitem",
]);

/** Whether `element`, whose computed role is `role`, can report `expanded`. */
export function canExpand(element: Element, role: string): boolean {
  return EXPANDABLE_ROLES.has(role) && !isImplicitGridCell(element);
}
