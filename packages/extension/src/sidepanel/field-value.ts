/**
 * How a tree row shows a field's value (ADR-0001): what a screen reader
 * announces, Chromium's own value — a `<select>` reads `= "Spain"`.
 *
 * It doesn't redact: a sensitive field's value is already `[redacted]`
 * before it reaches the panel (`pageReadValue`), and it prints as that.
 */

/** `= "Spain"` — JSON-escaped, the way the serializers print a value. */
export function announcedValueLabel(value: string): string {
  return `= ${JSON.stringify(value)}`;
}
