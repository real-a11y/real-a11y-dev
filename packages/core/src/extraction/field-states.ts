import { ariaBoolean, ariaInvalid } from "./aria-tokens.js";
import {
  safeGetAttribute,
  safeMatches,
  safeParentElement,
  safeTagName,
} from "./clobber-safe.js";
import { HTML_INPUT_READONLY_ROLES } from "./input-type-roles.js";
import { isSensitiveField } from "./sensitivity.js";

/** `<input>` types the `readonly` attribute applies to (HTML, 4.10.5.3). */
const READONLY_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "date",
  "month",
  "week",
  "time",
  "datetime-local",
  "number",
]);

/** The roles that carry aria-readonly, which these fields can have. */
/** Every `<input>` type the HTML spec defines; any other falls back to text. */
const KNOWN_TYPES = new Set([
  ...READONLY_INPUT_TYPES,
  "hidden",
  "checkbox",
  "radio",
  "range",
  "color",
  "file",
  "submit",
  "image",
  "reset",
  "button",
]);

const READONLY_ROLES = new Set([
  "textbox",
  ...HTML_INPUT_READONLY_ROLES,

  "searchbox",
  "combobox",
  "spinbutton",
]);

/** Whether the element carries a `readonly` attribute that HTML honors. */
function allowsReadonly(element: Element, tag: string, role: string): boolean {
  if (safeGetAttribute(element, "readonly") === null) return false;
  if (!READONLY_ROLES.has(role)) return false;
  if (tag === "textarea") return true;
  if (tag !== "input") return false;
  // Read the attribute, not `.type`, which a control named "type" can shadow.
  // An unknown or missing type is a text field.
  const type = (safeGetAttribute(element, "type") ?? "text")
    .trim()
    .toLowerCase();
  return READONLY_INPUT_TYPES.has(type) || !KNOWN_TYPES.has(type);
}

/** The form controls that can be candidates for constraint validation. */
const VALIDATED_TAGS = new Set(["input", "button", "select", "textarea"]);

/**
 * True when a form control fails HTML constraint validation in a way HTML-AAM
 * exposes as invalid: a `pattern` mismatch, a bad email or URL, a number out
 * of range, an error set with `setCustomValidity()`, and so on.
 *
 * Only a candidate for constraint validation can fail it. A control HTML bars
 * from it never does, whatever custom error it holds: a disabled or readonly
 * one, a plain or reset button, or one inside a `<datalist>`. Chromium 153
 * reports a barred control with a custom error invalid all the same; this
 * follows HTML instead.
 *
 * A required control that is only empty fails once `:user-invalid` matches
 * it, which is after the user has interacted with it or tried to submit its
 * form. HTML-AAM says user agents "MUST NOT expose the element with an
 * initial invalid state" and "SHOULD expose the invalid state only after"
 * one of those. Chromium 153 never reports an empty text field invalid, and
 * reports an empty required `<select>`, checkbox or radio invalid from the
 * start. An engine without `:user-invalid`, such as an older browser, never
 * reports an empty one invalid. jsdom has the selector but never matches it.
 */
export function failsValidation(element: Element, tag: string): boolean {
  if (!VALIDATED_TAGS.has(tag)) return false;
  // None of these four is a <form>, so no field can shadow these properties.
  const control = element as HTMLInputElement;
  if (!control.willValidate) return false;
  const { validity } = control;
  if (!validity || validity.valid) return false;
  // Any failure but an empty required value counts at once. No other flag
  // applies to an empty value, a custom error or unparsable input aside.
  if (!validity.valueMissing || validity.customError || validity.badInput)
    return true;
  try {
    return safeMatches(element, ":user-invalid");
  } catch {
    // Chromium before 119, Firefox before 88 and Safari before 16.5 throw on
    // the selector.
    return false;
  }
}

/**
 * What an element's own validity says about its `invalid` state: whether it
 * fails validation, or `null` when validity has no say, because the element
 * is no form control that validates or an authored `aria-invalid` decides.
 * The one place that precedence is written, for the extractor and for a live
 * refresh checking whether validity moved.
 */
export function validityInvalid(element: Element, tag: string): boolean | null {
  if (!VALIDATED_TAGS.has(tag)) return null;
  if (ariaInvalid(safeGetAttribute(element, "aria-invalid")) !== null)
    return null;
  return failsValidation(element, tag);
}

/**
 * The states HTML gives a form field of its own: `required`, `readonly`, and
 * `invalid` when it fails constraint validation. HTML-AAM maps the `readonly`
 * attribute to aria-readonly="true", and it wins over an aria-readonly on the
 * same element. An authored aria-invalid, read before this, wins over the
 * field's validity instead, as in Chromium: `aria-invalid="false"` keeps a
 * field that fails its `pattern` valid. Only true is recorded.
 */
export function addFieldStates(
  element: Element,
  tag: string,
  role: string,
  states: Record<string, string | boolean>,
): void {
  const htmlEl = element as HTMLInputElement;
  if (
    tag === "input" ||
    tag === "button" ||
    tag === "select" ||
    tag === "textarea"
  ) {
    if ("required" in htmlEl && htmlEl.required) states["required"] = true;
  }
  if (allowsReadonly(element, tag, role)) states["readonly"] = true;
  if (validityInvalid(element, tag)) states["invalid"] = true;
}

/**
 * The `selected` state of a native `<option>`, from its selectedness. Read
 * from the `selected` property, not the attribute: a user's pick or a script
 * setting `option.selected` moves the first and not the second.
 *
 * @internal Called by `nativeStates`; not a supported entry point.
 *
 * An authored aria-selected keeps winning, as in Chromium. A select that
 * `isSensitiveField` classifies gets no `selected` at all: which option is chosen
 * is the value its own `[redacted]` withholds.
 */
export function optionStates(
  element: Element,
  tag: string,
  role: string,
): Record<string, boolean | undefined> {
  if (tag !== "option" || role !== "option") return {};
  if (ariaBoolean(safeGetAttribute(element, "aria-selected")) !== null)
    return {};
  const select = owningSelect(element);
  if (!select) return {};
  return isSensitiveField(select)
    ? { selected: undefined }
    : { selected: (element as HTMLOptionElement).selected };
}

/** The `<select>` an `<option>` belongs to, through at most one `<optgroup>`. */
function owningSelect(option: Element): Element | null {
  let parent = safeParentElement(option);
  if (parent && safeTagName(parent) === "optgroup")
    parent = safeParentElement(parent);
  return parent && safeTagName(parent) === "select" ? parent : null;
}
