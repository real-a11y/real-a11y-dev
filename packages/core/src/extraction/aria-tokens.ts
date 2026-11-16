/**
 * ARIA state values, read the way Chromium reads them.
 *
 * Every rule here was measured against Chromium 151's own tree, value by
 * value: CDP `Accessibility.getFullAXTree`, and chrome://accessibility for
 * `aria-current`, which CDP doesn't expose. `aria-invalid`'s was measured
 * against Chromium 153 with CDP `Accessibility.getPartialAXTree`. None of
 * them trims, so `" true"` is not `"true"`, and none of them is the literal
 * comparison it replaces: `aria-disabled="TRUE"` disables,
 * `aria-hidden="yes"` hides, and `aria-pressed="UNDEFINED"` presses.
 *
 * One rule departs from Chromium on purpose: `aria-invalid`'s `grammar` and
 * `spelling` keep the meaning WAI-ARIA 1.2 gives them. See
 * {@link ariaInvalid}.
 *
 * Kept free of imports so that every module reading one of these attributes
 * can share it, `role-map` and `flat-tree` included.
 */

/**
 * A boolean ARIA state: `null` when absent, empty or `undefined`, which leaves
 * it unset; `false` for `false`; and `true` for any other value, `yes`,
 * `mixed` and `" false"` included. Case is ignored.
 *
 * `aria-disabled`, `aria-hidden`, `aria-busy`, `aria-required`,
 * `aria-readonly`, `aria-expanded` and `aria-selected` all read this way.
 */
export function ariaBoolean(value: string | null | undefined): boolean | null {
  if (value === null || value === undefined) return null;
  const token = value.toLowerCase();
  if (token === "" || token === "undefined") return null;
  return token !== "false";
}

/** True when an `aria-hidden` value hides its element, as Chromium reads it. */
export function isAriaHiddenValue(value: string | null | undefined): boolean {
  return ariaBoolean(value) === true;
}

/**
 * The leading part of the two rules below: `null` when absent, empty or
 * `undefined`, and `false` for `false`, else the lowercased token. Unlike
 * {@link ariaBoolean}, only a lowercase `undefined` leaves the state unset;
 * Chromium reads `UNDEFINED` as any other unknown value.
 */
function ariaToken(value: string | null | undefined): string | false | null {
  if (value === null || value === undefined) return null;
  if (value === "" || value === "undefined") return null;
  const token = value.toLowerCase();
  return token === "false" ? false : token;
}

/** Roles with no mixed state, whose `aria-checked="mixed"` Chromium reads as false. */
const NO_MIXED_ROLES = new Set(["radio", "switch", "menuitemradio"]);

/**
 * A tristate ARIA state, `aria-checked` or `aria-pressed`: as
 * {@link ariaToken} for absent, empty, `undefined` and `false`; `"mixed"` for
 * `mixed` in any case; and `true` for any other value.
 *
 * Pass `role` for `aria-checked`: a radio, switch or menuitemradio has no
 * mixed state, and Chromium reads theirs as false.
 */
export function ariaTristate(
  value: string | null | undefined,
  role?: string,
): boolean | "mixed" | null {
  const token = ariaToken(value);
  if (token === null || token === false) return token;
  if (token !== "mixed") return true;
  return role !== undefined && NO_MIXED_ROLES.has(role) ? false : "mixed";
}

/** The `aria-current` values Chromium keeps as themselves. */
const CURRENT_TOKENS = new Set(["page", "step", "location", "date", "time"]);

/**
 * `aria-current`: as {@link ariaToken} for absent, empty, `undefined` and
 * `false`; one of `page`, `step`, `location`, `date` or `time`, lowercased,
 * for that token in any case; and `true` for any other value.
 */
export function ariaCurrent(
  value: string | null | undefined,
): boolean | string | null {
  const token = ariaToken(value);
  if (token === null || token === false) return token;
  return CURRENT_TOKENS.has(token) ? token : true;
}

/**
 * `aria-invalid`: as {@link ariaToken} for absent, empty, `undefined` and
 * `false`; `"grammar"` or `"spelling"` for that token in any case; and `true`
 * for any other value, `" false"` included.
 *
 * The two tokens follow WAI-ARIA 1.2, not Chromium. The spec makes
 * `aria-invalid` a token on every role, and `grammar` and `spelling` say what
 * kind of error the value has. Chromium 153 reads both as `true` on a
 * `textbox` and drops them on every other role, `searchbox` and `combobox`
 * included, where it marks the misspelled text instead. So for those two
 * values a DOM tree says more than a native one: `"spelling"` where native
 * says `true`, or nothing.
 */
export function ariaInvalid(
  value: string | null | undefined,
): boolean | "grammar" | "spelling" | null {
  const token = ariaToken(value);
  if (token === null || token === false) return token;
  return token === "grammar" || token === "spelling" ? token : true;
}
