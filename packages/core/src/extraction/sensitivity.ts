/**
 * The field-value sensitivity policy (ADR-0001): which fields never give their
 * value away, and what stands in for it. One policy for every producer — the
 * DOM walk reads it off an element, the native producer off CDP's attributes.
 */
import { safeGetAttribute, safeTagName } from "./clobber-safe.js";

/**
 * Autocomplete field names (WHATWG autofill tokens) that identify a control
 * holding a secret. Matched against each space-separated token of an
 * element's `autocomplete` value.
 *
 * This list IS the sensitivity policy (ADR-0001): together with
 * `type="password"` it is the whole of what every producer withholds. It grows
 * only by a later decision. Exported so a copy that cannot import it — the
 * extension's in-page `pageReadValue`, which runs as source text over CDP —
 * can be pinned to it by a parity test.
 */
export const SENSITIVE_AUTOCOMPLETE_TOKENS: ReadonlySet<string> = new Set([
  "current-password",
  "new-password",
  "one-time-code",
  "cc-number",
  "cc-csc",
  "cc-exp",
  "cc-exp-month",
  "cc-exp-year",
]);

/** Substituted for a sensitive field's value, wherever a value is shown. */
export const REDACTED_VALUE = "[redacted]";

/**
 * The sensitivity policy over a field's markup alone — its tag name plus its
 * `type` and `autocomplete` attributes — for callers with no live `Element`.
 * The native producer holds exactly this: CDP's `DOM.getDocument` attributes,
 * never a field's value. {@link isSensitiveField} is this, read off an element.
 */
export function isSensitiveFieldAttributes(
  tagName: string,
  attributes: { type?: string | null; autocomplete?: string | null },
): boolean {
  const tag = tagName.toLowerCase();
  if (tag !== "input" && tag !== "textarea" && tag !== "select") {
    return false;
  }
  if (
    tag === "input" &&
    (attributes.type ?? "").trim().toLowerCase() === "password"
  ) {
    return true;
  }
  for (const token of (attributes.autocomplete ?? "")
    .toLowerCase()
    .split(/\s+/)) {
    if (SENSITIVE_AUTOCOMPLETE_TOKENS.has(token)) return true;
  }
  return false;
}

/**
 * True if `element` is a form field whose live value must never be captured
 * into the semantic tree — a password `<input>`, or any input/textarea/select
 * whose `autocomplete` names a credential or payment field.
 *
 * The extracted tree flows into serializer snapshots (committed to git and
 * CI), the testing package's assertions, and the Chrome extension's message
 * channel. A secret typed into such a field must not ride along, so callers
 * that read `.value` — `extractDomTree` via `getKeyAttributes` and
 * `getAnnouncedValue`, the accessible-name fallback, and downstream consumers
 * like the extension's field-state read — gate on this predicate.
 */
export function isSensitiveField(element: Element): boolean {
  return isSensitiveFieldAttributes(safeTagName(element), {
    // The `type` PROPERTY, not the attribute: it is what the browser actually
    // renders, normalized (an unknown or missing type reads as "text").
    // Tag-checked rather than `instanceof`, which fails across realms.
    type:
      safeTagName(element) === "input"
        ? (element as HTMLInputElement).type
        : safeGetAttribute(element, "type"),
    autocomplete: safeGetAttribute(element, "autocomplete"),
  });
}
