/**
 * Name sources HTML-AAM defines for specific elements, read by the DOM
 * producer's name computation (`computeRawAccessibleName`).
 */
import { safeGetAttribute } from "./clobber-safe.js";
import { buttonInputName } from "./input-names.js";
import { isSensitiveField } from "./sensitivity.js";

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

/**
 * Step 5 of a name: button-like inputs (submit/reset/button) take their name
 * from the `value` attribute (HTML-AAM), and an image input from its `alt`,
 * else a submit or reset input its default ("Submit", "Reset"). For any
 * other input the value is the user's DATA, not a name — an unlabeled text
 * field must read as unnamed rather than echo what was typed, and an
 * unlabeled checkbox must not inherit its default value "on". That matches
 * what assistive tech announces and stops @real-a11y-dev/testing from passing
 * genuinely unlabeled controls. (The sensitive-value guard is kept for
 * defense in depth; a password field is never button-like.)
 */
export function inputValueName(element: Element, tag: string): string | null {
  if (tag !== "input") return null;
  const input = element as HTMLInputElement;
  const type = input.type;
  if (
    (type === "submit" || type === "reset" || type === "button") &&
    input.value &&
    !isSensitiveField(input)
  )
    return input.value;
  return buttonInputName(input, "beforeTitle");
}

/**
 * The last steps of a name: the `title` attribute (6), an image input's
 * default "Submit" (6a, HTML-AAM §4.1.3), then a text field's placeholder (7).
 * The Tooltip step is last (AccName 1.2 §4.3.2 2I: "only if nothing else,
 * including subtree content, has provided results"), so this sits after
 * name-from-content, and HTML-AAM orders title before placeholder. A
 * `<textarea>`'s placeholder counts: Chromium names `<textarea
 * placeholder="Your reply">` "Your reply". "" when none applies.
 */
export function tooltipText(
  element: Element,
  tag: string,
  source?: { fromTitle?: boolean },
): string {
  const title = safeGetAttribute(element, "title");
  if (title) {
    if (source) source.fromTitle = true;
    return title;
  }
  const fallback = buttonInputName(element, "afterTitle");
  if (fallback) return fallback;
  return tag === "input" || tag === "textarea" ? placeholderName(element) : "";
}
