import { roleTakesState } from "./aria-state-roles.js";
import { ariaTristate } from "./aria-tokens.js";
import {
  safeGetAttribute,
  safeParentElement,
  safeTagName,
} from "./clobber-safe.js";
import {
  ARIA_STATE_ATTRIBUTES,
  ariaStateValue,
  CHECKEDNESS_ROLES,
  explicitAriaDisabled,
  inheritsDisabled,
  isDisabledControl,
  isPickerOpen,
  nativeChecked,
  takesInheritedDisabled,
} from "./element-state.js";
import { addFieldStates, optionStates } from "./field-states.js";
import { popoverExpanded } from "./popover-expanded.js";
import { getExplicitRole, isDropDownSelect } from "./role-map.js";

/**
 * Roles under which a `<details>`' summary takes `expanded` from the details,
 * measured against Chromium 151 across every ARIA role. Its own role, which
 * the engine calls `generic`, is a disclosure too.
 */
const SUMMARY_EXPANDED_ROLES = new Set([
  "application",
  "button",
  "checkbox",
  "columnheader",
  "combobox",
  "form",
  "gridcell",
  "link",
  "listitem",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "region",
  "row",
  "rowheader",
  "switch",
  "tab",
  "treeitem",
]);

/**
 * The `expanded` state {@link getAriaStates} gives `element` in `role`.
 *
 * A popover shows and hides with no mutation on the controls that invoke it,
 * so `LiveTreeExtractor` re-reads this for each of them on refresh. It asks
 * `getAriaStates` itself rather than restating its precedence, which would
 * drift. `focusable` decides only `disabled`, so it is passed as false.
 */
export function expandedState(
  element: Element,
  role: string,
): boolean | undefined {
  return getAriaStates(element, role, false)["expanded"] as boolean | undefined;
}

/**
 * The states an element's own semantics decide, which Chromium reads in
 * place of the matching ARIA attribute. A state mapped to `undefined` is one
 * the element doesn't have, whatever its attribute says. `role` is its
 * computed role. Each rule was measured against Chromium 151.
 *
 * - A native checkbox or radio: its checkedness ({@link nativeChecked}) is
 *   `checked` on a role in {@link CHECKEDNESS_ROLES}, and on an `option` or
 *   `treeitem` while `aria-checked` is set. It is `pressed` instead on a
 *   `button` with `aria-pressed`, a toggle button. Any other role has neither.
 * - A `<select>` as a combobox or list box: a drop-down
 *   ({@link isDropDownSelect}) in the combobox role is expanded while its
 *   picker is open. A list box has no expanded state, unless the author gave
 *   it the combobox role, which reads `aria-expanded` as usual. Neither is a
 *   toggle button, so neither has `pressed`. Any other author role reads
 *   `aria-expanded` and `aria-pressed` as usual.
 * - Any `<summary>` child of a `<details>`, not only the one that toggles it:
 *   `expanded` is whether the details is open, in its own role or one in
 *   {@link SUMMARY_EXPANDED_ROLES}, and nothing under any other role. Only a
 *   `button` role makes it a toggle button, with a `pressed`.
 * - A `<button>` or `<input>` that invokes a popover: `expanded` is whether
 *   the popover is showing, from {@link popoverExpanded}.
 * - An `<option>` of a `<select>`, in the `option` role: `selected` is its
 *   selectedness, HTML-AAM's mapping, and `false` when it isn't selected. An
 *   authored `aria-selected` still wins when it is a valid boolean: Chromium
 *   151 reports `aria-selected="true"` on an unselected option as selected,
 *   and `"false"` on the selected one as not. A select the field-value rules
 *   withhold ({@link isSensitiveField}) gets no `selected` at all, since
 *   which option is chosen is the value they withhold.
 */
export function nativeStates(
  element: Element,
  tag: string,
  role: string,
): Record<string, boolean | string | undefined> {
  const checked = nativeChecked(element);
  if (checked !== null) {
    const ariaSet = (attr: string) =>
      ariaTristate(safeGetAttribute(element, attr)) !== null;
    if (role === "button" && ariaSet("aria-pressed"))
      return { checked: undefined, pressed: checked };
    const exposed =
      CHECKEDNESS_ROLES.has(role) ||
      ((role === "option" || role === "treeitem") && ariaSet("aria-checked"));
    return { checked: exposed ? checked : undefined, pressed: undefined };
  }
  if (tag === "select") return selectStates(element, role);
  if (tag === "button" || tag === "input") {
    const expanded = popoverExpanded(element, tag, role);
    return expanded === null ? {} : { expanded };
  }
  if (tag !== "summary") return optionStates(element, tag, role);
  return summaryStates(element, role);
}

function selectStates(
  element: Element,
  role: string,
): Record<string, boolean | undefined> {
  if (role !== "combobox" && role !== "listbox") return {};
  if (role === "combobox" && isDropDownSelect(element))
    return { expanded: isPickerOpen(element), pressed: undefined };
  // A list box has no expanded state, unless an author's combobox role
  // gives it one, read from aria-expanded as usual. Asked of the authored
  // role, not `role`: the live extractor passes the role it recorded, which
  // a since-changed `role`, `size` or `multiple` leaves stale.
  return getExplicitRole(element) === "combobox"
    ? { pressed: undefined }
    : { expanded: undefined, pressed: undefined };
}

function summaryStates(
  element: Element,
  role: string,
): Record<string, boolean | undefined> {
  // Read only for a summary: on a <form>, a field named `parentElement`
  // shadows the property.
  const details = safeParentElement(element);
  if (details && safeTagName(details) === "details") {
    const disclosure =
      (role === "generic" && getExplicitRole(element) !== "generic") ||
      SUMMARY_EXPANDED_ROLES.has(role);
    const expanded = disclosure
      ? (details as HTMLDetailsElement).open
      : undefined;
    return role === "button" ? { expanded } : { expanded, pressed: undefined };
  }
  return {};
}

/**
 * Get ARIA states from an element. `role` is its computed role, and
 * `focusable` its `isFocusable()` answer, both of which the caller already
 * has.
 */
export function getAriaStates(
  element: Element,
  role: string,
  focusable: boolean,
): Record<string, string | boolean> {
  const states: Record<string, string | boolean> = {};
  const tag = safeTagName(element);
  const native = nativeStates(element, tag, role);

  for (const attr of ARIA_STATE_ATTRIBUTES) {
    const state = attr.slice("aria-".length);
    // The element's own semantics decide it, below.
    if (state in native) continue;
    // Chromium never marks an optgroup disabled, whatever its role. Its
    // options still inherit the state from it, below.
    if (attr === "aria-disabled" && tag === "optgroup") continue;
    if (!roleTakesState(element, attr, role)) continue;
    const value = ariaStateValue(element, attr, role);
    if (value !== null) states[state] = value;
  }
  for (const [state, value] of Object.entries(native))
    if (value !== undefined) states[state] = value;

  addFieldStates(element, tag, role, states);

  // A disabled control is disabled whatever its aria-disabled says. Anything
  // else with an explicit aria-disabled keeps it. The rest inherit from an
  // ancestor, if Chromium counts them focusable, as CORE-AAM says.
  if (isDisabledControl(element)) {
    states["disabled"] = true;
  } else if (
    explicitAriaDisabled(element) === null &&
    takesInheritedDisabled(element, tag, focusable) &&
    inheritsDisabled(element)
  ) {
    states["disabled"] = true;
  }

  return states;
}
