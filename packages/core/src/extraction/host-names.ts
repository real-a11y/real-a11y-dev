/**
 * Name sources HTML-AAM defines for specific elements, read by the DOM
 * producer's name computation (`computeRawAccessibleName`).
 */
import { safeGetAttribute } from "./clobber-safe.js";

/** Elements a `<label>` names (HTML-AAM §4.1.1, §4.1.6, §4.1.7). */
export const LABELED_TAGS: ReadonlySet<string> = new Set([
  "input",
  "select",
  "textarea",
  "output",
  "meter",
  "progress",
]);

/**
 * The `label` attribute of an `<option>` or `<optgroup>`, which names it ahead
 * of its text (HTML-AAM §3.6.76). Empty when absent or blank.
 */
export function labelAttributeName(element: Element, tag: string): string {
  if (tag !== "option" && tag !== "optgroup") return "";
  return safeGetAttribute(element, "label")?.trim() ?? "";
}

/**
 * A text field's last-resort name: `placeholder`, else `aria-placeholder`.
 * HTML-AAM §3.6.106 ignores `aria-placeholder` when `placeholder` is non-empty.
 */
export function placeholderName(element: Element): string {
  const placeholder = (element as HTMLInputElement | HTMLTextAreaElement)
    .placeholder;
  return (
    placeholder || safeGetAttribute(element, "aria-placeholder")?.trim() || ""
  );
}
