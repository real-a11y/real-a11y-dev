import { safeGetAttribute, safeTagName } from "./clobber-safe.js";

/**
 * The name an `<input>` button gets from its markup when nothing before the
 * `title` step has named it, or, for an image input, nothing at all has.
 *
 * - `beforeTitle`: a submit or reset input with no `value` ATTRIBUTE gets the
 *   user agent's default, "Submit" or "Reset" (HTML-AAM §4.1.2). An explicit
 *   `value=""` is a stated empty name and gets none, and `type="button"` has
 *   no default. An image input is named by a non-empty `alt`, after any label,
 *   which Chromium prefers: `<label><input type="image" alt="Go"> now</label>`
 *   is "now".
 * - `afterTitle`: an image input nothing else has named is a submit button,
 *   and is called one (HTML-AAM §4.1.3). Unlike submit and reset, this default
 *   comes after `title`.
 *
 * The strings are fixed English, where a browser localizes its own.
 */
export function buttonInputName(
  element: Element,
  phase: "beforeTitle" | "afterTitle",
): string | null {
  if (safeTagName(element) !== "input") return null;
  const type = (element as HTMLInputElement).type;
  if (phase === "afterTitle") return type === "image" ? "Submit" : null;
  if (type === "image") return safeGetAttribute(element, "alt") || null;
  if (
    (type === "submit" || type === "reset") &&
    !element.hasAttribute("value")
  ) {
    return type === "submit" ? "Submit" : "Reset";
  }
  return null;
}
