/**
 * The AX property names the native side keeps, split by where they land
 * (`a11y.states` or `a11y.properties`). Moved out of `native-core.ts` so the
 * file stays within its length ceiling; the two sets are unchanged and stay
 * in lockstep with `browser`'s own copies.
 */

/**
 * AX property names that map to boolean/stateful `a11y.states`. Kept in
 * lockstep with `browser`'s `STATE_PROPS` — the shared ARIA-derived keys
 * (`checked`, `expanded`, `pressed`, `selected`, `disabled`, `required`,
 * `invalid`) match what the DOM producer writes, so cross-producer dogfood
 * comparison reads the same vocabulary.
 */
export const STATE_PROPS = new Set([
  "focusable",
  "focused",
  "editable",
  "settable",
  "checked",
  "expanded",
  "pressed",
  "selected",
  "disabled",
  "readonly",
  "required",
  "multiline",
  "invalid",
  "modal",
  "busy",
]);

/**
 * AX property names that map to descriptive `a11y.properties` (strings).
 *
 * R1: `valuenow` / `valuetext` stay EXCLUDED here — this is Chromium's own
 * CDP payload, and it cannot be trusted to have already redacted a sensitive
 * field: it masks passwords but not, e.g. a `cc-number` field on a plain
 * `type="text"` input (the exact caveat `browser`'s own R1 header
 * documents). A node's value reaches it only as `value`, through
 * `fieldFacets`, and only once `pageReadValue` has classified the element
 * in-page — the RFC's own requirement for when values are "genuinely
 * needed": "capture MUST classify sensitivity in-page." Piping these two
 * properties through untouched would bypass that classification entirely.
 * `valuemin` / `valuemax` are authored bounds, not user data, so they stay.
 */
export const DETAIL_PROPS = new Set([
  "level",
  "valuemin",
  "valuemax",
  "hasPopup",
  "keyshortcuts",
  "roledescription",
  "orientation",
  "autocomplete",
]);
