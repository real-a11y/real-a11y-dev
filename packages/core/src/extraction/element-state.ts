import { ariaBoolean, ariaCurrent, ariaTristate } from "./aria-tokens.js";
import { safeGetAttribute, safeTagName } from "./clobber-safe.js";
import { isEditable, isEditingHost } from "./editing.js";
import { flatParent } from "./flat-tree.js";
import { isActuallyDisabled, parseTabindex } from "./focusability.js";

/** Form controls whose `disabled` Chromium reports, and passes to their content. */
const DISABLEABLE_TAGS = new Set(["button", "input", "select", "textarea"]);

/**
 * True for a control HTML calls disabled, which Chromium reports disabled.
 *
 * Not a `<fieldset>`, although `:disabled` matches one: Chromium reports
 * neither the fieldset nor its non-control content disabled. Its effect
 * reaches the controls it disables, and through them their content.
 */
export function isDisabledControl(element: Element): boolean {
  const tag = safeTagName(element);
  if (tag === "option") return isDisabledOption(element);
  // Not `.disabled`, which misses a control disabled by its fieldset.
  return DISABLEABLE_TAGS.has(tag) && isActuallyDisabled(element);
}

/**
 * An option HTML calls disabled: by its own `disabled`, or by its parent
 * `<optgroup disabled>`.
 *
 * Not `:disabled`, which Chromium 151 also matches for every option in a
 * disabled `<select>`. Its accessibility tree treats that option as
 * inheriting the state instead, which the option's own `aria-disabled="false"`
 * overrides, as does that of an optgroup in between.
 */
function isDisabledOption(option: Element): boolean {
  if (option.hasAttribute("disabled")) return true;
  // eslint-disable-next-line no-restricted-properties -- one read, and an <option> is never a form
  const parent = option.parentElement;
  return (
    !!parent &&
    safeTagName(parent) === "optgroup" &&
    parent.hasAttribute("disabled")
  );
}

/**
 * `aria-disabled` as Chromium reads it: `null` when absent, empty or
 * `undefined`, which leaves the element to inherit. See `ariaBoolean`.
 */
export function explicitAriaDisabled(element: Element): boolean | null {
  return ariaBoolean(safeGetAttribute(element, "aria-disabled"));
}

/**
 * True when an ancestor disables `element`, the way Chromium passes the state
 * down its accessibility tree: the nearest flat-tree ancestor that is a
 * disabled control, or that sets `aria-disabled` explicitly, decides.
 *
 * A disabled control decides `true` whatever its own `aria-disabled` says,
 * since that can't re-enable it. An explicit `aria-disabled="false"` in
 * between decides `false`. The walk goes past the extraction root on purpose:
 * the live extractor re-extracts one mutated subtree at a time, and an
 * ancestor above it still counts.
 */
export function inheritsDisabled(element: Element): boolean {
  for (let el = flatParent(element); el; el = flatParent(el)) {
    if (isDisabledControl(el)) return true;
    const explicit = explicitAriaDisabled(el);
    if (explicit !== null) return explicit;
  }
  return false;
}

/**
 * True when Chromium's tree counts `element` as focusable, which is what lets
 * it inherit `disabled` (CORE-AAM). That is `isFocusable()`'s answer, adjusted
 * the three ways Chromium differs from it:
 *
 * - A native `<option>` counts, which is how every option in a disabled
 *   select comes out disabled.
 * - An editing host counts: Chromium focuses one with no `tabindex`, and
 *   `isFocusable()` doesn't count it yet.
 * - A link inside editable content doesn't, because editing takes its focus
 *   away, unless a `tabindex` gives it back.
 */
export function takesInheritedDisabled(
  element: Element,
  tag: string,
  focusable: boolean,
): boolean {
  if (tag === "option" || isEditingHost(element)) return true;
  if (!focusable) return false;
  return !(
    tag === "a" &&
    parseTabindex(safeGetAttribute(element, "tabindex")) === null &&
    isEditable(element)
  );
}

/**
 * One ARIA state attribute's value as Chromium reads it, or `null` when that
 * leaves the state unset. `role` is the element's computed role, which
 * decides whether `aria-checked` can be mixed.
 */
export function ariaStateValue(
  element: Element,
  attr: string,
  role: string,
): boolean | string | null {
  const value = safeGetAttribute(element, attr);
  switch (attr) {
    case "aria-checked":
      return ariaTristate(value, role);
    case "aria-pressed":
      return ariaTristate(value);
    case "aria-current":
      return ariaCurrent(value);
    default:
      return ariaBoolean(value);
  }
}

/**
 * A native checkbox's or radio's checkedness, and `"mixed"` for an
 * indeterminate checkbox, which Chromium reads in place of `aria-checked` and
 * `aria-pressed`. `null` for any other element, including any other `<input>`
 * type, which reads `aria-checked` as usual.
 *
 * `indeterminate` is a property with no attribute, and script is the only
 * thing that sets it, so no mutation reports the change. `LiveTreeExtractor`
 * re-reads every checkbox and radio on refresh for that reason.
 */
export function nativeChecked(element: Element): boolean | "mixed" | null {
  if (safeTagName(element) !== "input") return null;
  const input = element as HTMLInputElement;
  if (input.type === "checkbox")
    return input.indeterminate ? "mixed" : input.checked;
  return input.type === "radio" ? input.checked : null;
}

/**
 * Whether a drop-down `<select>`'s picker is open, which is its expanded
 * state in Chromium's tree. An engine without the `:open` pseudo-class throws
 * on it, and has no other way to tell.
 */
export function isPickerOpen(select: Element): boolean {
  try {
    return select.matches(":open");
  } catch {
    return false;
  }
}
