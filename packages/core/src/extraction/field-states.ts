import { ariaBoolean } from "./aria-tokens.js";
import {
  safeGetAttribute,
  safeParentElement,
  safeTagName,
} from "./clobber-safe.js";
import { isSensitiveField } from "./dom-extractor.js";

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

/**
 * The states HTML gives a form field of its own: `required`, and `readonly`.
 * HTML-AAM maps the `readonly` attribute to aria-readonly="true", and it wins
 * over an aria-readonly on the same element. Only true is recorded.
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
}

/**
 * The `selected` state of a native `<option>`, from its selectedness. Read
 * from the `selected` property, not the attribute: a user's pick or a script
 * setting `option.selected` moves the first and not the second.
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
