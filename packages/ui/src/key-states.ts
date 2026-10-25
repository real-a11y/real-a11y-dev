/**
 * The states that change what a row's element is or does: whether it is
 * disabled, checked, pressed, selected, expanded or collapsed, required,
 * invalid, read-only, busy or current. A narrow row keeps their badges with
 * its name (tree.css, "Long labels"), where the rest of a row's badges give
 * way to the name: a row that dropped one would misreport its element, a
 * disabled button reading as an enabled one. A hidden element's whole row is
 * dimmed instead.
 */
const KEY_STATES: ReadonlySet<string> = new Set([
  "disabled",
  "checked",
  "pressed",
  "selected",
  "expanded",
  "required",
  "invalid",
  "readonly",
  "busy",
  "current",
]);

/** True for a state whose badge stays with the row's name. */
export function isKeyState(state: string): boolean {
  return KEY_STATES.has(state);
}
