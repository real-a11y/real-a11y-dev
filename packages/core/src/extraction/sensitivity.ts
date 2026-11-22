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

/** The elements {@link isSensitiveField} can be true of. */
export const FIELD_TAGS: ReadonlySet<string> = new Set([
  "input",
  "textarea",
  "select",
]);

/** {@link FIELD_TAGS} as a selector. */
export const FIELD_SELECTOR = [...FIELD_TAGS].join(", ");

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
  if (!FIELD_TAGS.has(tag)) return false;
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

/**
 * The roles a popup's choice is made in: those `aria-haspopup` names but a
 * dialog, which holds anything, and a radio group, which a dialog popup can
 * hold. A name or description that reads one with a choice made in it
 * ({@link isChoiceState}) gives that choice away, and the container an
 * `aria-activedescendant` sits in is the popup it reaches. One set for the DOM
 * producer (`lendsSensitiveChoice`) and the native ones (`sensitivePopupRoots`).
 */
export const POPUP_CHOICE_ROLES: ReadonlySet<string> = new Set([
  "listbox",
  "grid",
  "treegrid",
  "tree",
  "menu",
  "radiogroup",
]);

/**
 * The roles whose `checked` marks which item of a set is chosen: an option or
 * tree item that marks its choice with `aria-checked`, a menu's radio and
 * check items, and a radio. A menu's check item is one of its choices, in a
 * menu that picks several, as an option in a multi-select list box is. Not a
 * checkbox or a switch: each is a control of its own, classified for
 * sensitivity on its own, so one in a panel a sensitive field controls keeps
 * its state.
 */
export const CHOICE_ITEM_ROLES: ReadonlySet<string> = new Set([
  "option",
  "treeitem",
  "menuitemradio",
  "menuitemcheckbox",
  "radio",
]);

/**
 * True when `state` on a node in `role` can say which choice is made, so it
 * is withheld wherever a sensitive field's choice is made (ADR-0001):
 * `selected` on anything, as Chromium carries it on options, tabs, rows and
 * cells; `checked` on a choice item ({@link CHOICE_ITEM_ROLES}); and `pressed`
 * and `current`, which a page can mark its chosen item with too (a date
 * picker's pressed day button, an option marked `aria-current`). One rule for
 * the DOM producer (`withholdsState`) and the native ones
 * (`dropChoiceStates`).
 *
 * @internal Shared with the native transports and the extension's panel.
 */
export function isChoiceState(state: string, role: string): boolean {
  if (state === "checked") return CHOICE_ITEM_ROLES.has(role);
  return state === "selected" || state === "pressed" || state === "current";
}

/** `<input>` types with no announced value: a state, a name, or nothing. */
export const VALUELESS_INPUT_TYPES: ReadonlySet<string> = new Set([
  "checkbox",
  "radio",
  "button",
  "submit",
  "reset",
  "image",
  "hidden",
]);

/**
 * True when what a field's `value` holds is what a user entered: any form
 * field but an `<input>` whose type has no announced value (a button's
 * `value` is the page's label for it, a checkbox's its form value). Read from
 * the tag name and `type` attribute alone, so both producers ask it alike.
 */
export function holdsEnteredValue(
  tagName: string,
  type: string | null | undefined,
): boolean {
  return (
    tagName.toLowerCase() !== "input" ||
    // Lower-cased, never trimmed: a browser matches the keyword ignoring case
    // only, so `type=" submit "` is a text field, and must count as entered.
    !VALUELESS_INPUT_TYPES.has((type ?? "text").toLowerCase())
  );
}
