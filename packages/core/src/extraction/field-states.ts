import { safeGetAttribute } from "./clobber-safe.js";

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

/** Whether the element carries a `readonly` attribute that HTML honors. */
function allowsReadonly(element: Element, tag: string): boolean {
  if (safeGetAttribute(element, "readonly") === null) return false;
  if (tag === "textarea") return true;
  if (tag !== "input") return false;
  // The `type` property folds an unknown or missing type to "text".
  const type = (element as HTMLInputElement).type;
  return typeof type === "string" && READONLY_INPUT_TYPES.has(type);
}

/**
 * The states HTML gives a form field of its own: `required`, and `readonly`.
 * HTML-AAM maps the `readonly` attribute to aria-readonly="true", and it wins
 * over an aria-readonly on the same element. Only true is recorded.
 */
export function addFieldStates(
  element: Element,
  tag: string,
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
  if (allowsReadonly(element, tag)) states["readonly"] = true;
}
