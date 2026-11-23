/**
 * The `<input>` states HTML-AAM gives "No corresponding role": color, date,
 * datetime-local, file, month, time and week. None of them is a `textbox`.
 * Where HTML-AAM has no role, the DOM producer prints its computed-role string
 * (`html-input-date`, ...), which HTML-AAM §3.5.1 defines for interoperability
 * testing, unless Chromium exposes an ARIA role the platform rows allow: a file
 * input is a `button` (Chromium's `computedRole`, and what the native producer
 * prints). Chromium's own CDP tokens (`ColorWell`, `Date`, `InputTime`, and
 * `DateTime` for three different types) are not used.
 *
 * The `html-*` strings are engine vocabulary, not ARIA roles, so they stay out
 * of `RECOGNISED_ROLES`: an authored `role="html-input-date"` falls back to the
 * implicit role, as Chromium does with any unknown token. Text, and any
 * unknown type, remain `textbox`.
 */
export const NO_ARIA_ROLE_INPUT_TYPE_ROLES: Readonly<Record<string, string>> = {
  color: "html-input-color",
  date: "html-input-date",
  "datetime-local": "html-input-datetime-local",
  file: "button",
  month: "html-input-month",
  time: "html-input-time",
  week: "html-input-week",
};

/** The `html-input-*` roles, for every set that listed `textbox` for a picker. */
export const HTML_INPUT_ROLES: readonly string[] = Object.values(
  NO_ARIA_ROLE_INPUT_TYPE_ROLES,
).filter((role) => role.startsWith("html-input-"));

/** The same, minus the colour well: HTML's `readonly` does not apply to it. */
export const HTML_INPUT_READONLY_ROLES: readonly string[] =
  HTML_INPUT_ROLES.filter((role) => role !== "html-input-color");

/**
 * `<input>` types whose value Chromium never reads into a name around them: a
 * colour well, and the date and time inputs, which Chromium exposes as their
 * parts. `<h2>Due <input type="date" value="2030-04-01"></h2>` is "Due" in
 * Chromium, and with `aria-label="Start"` on the input "Due Start": such an
 * input lends its name.
 */
export const NAMELESS_VALUE_INPUT_TYPES: ReadonlySet<string> = new Set([
  "color",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);
