/**
 * How a tree row shows a field's value (ADR-0001). Two views, two values:
 *
 *  - The **A11y view** shows what a screen reader announces — `a11y.value` in
 *    DOM mode, Chromium's own value in NATIVE mode: a `<select>` reads
 *    `= "Spain"`.
 *  - The **DOM view** shows the raw DOM value, `dom.attributes.value`: the
 *    same `<select>` reads `value="es"`.
 *
 * Neither function redacts: a sensitive field's value is already
 * `[redacted]` in both places before it reaches the panel (core's DOM
 * producer, and `pageReadValue` for NATIVE), and it prints as that.
 */

import { capText } from "../native/native-core.js";

/** The longest raw value the DOM view prints before cutting it with `…` —
 *  the same 240 characters the announced value is capped at. */
const RAW_VALUE_MAX = 240;

/** `= "Spain"` — JSON-escaped, the way the serializers print a value. */
export function announcedValueLabel(value: string): string {
  return `= ${JSON.stringify(value)}`;
}

/**
 * `value="es"` — the raw value, not whitespace-collapsed (it is raw), but cut
 * at {@link RAW_VALUE_MAX} characters so a long `<textarea>` stays one
 * readable row. JSON-escaped, so a line break reads as `\n`.
 */
export function rawValueLabel(raw: string): string {
  return `value=${JSON.stringify(capText(raw, RAW_VALUE_MAX))}`;
}
