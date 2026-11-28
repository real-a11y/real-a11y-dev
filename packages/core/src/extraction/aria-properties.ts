/**
 * The DOM producer's reader for `a11y.properties` beyond a heading's level
 * and a media element's `captions`. Keys come from the one table in
 * `a11y-properties.ts`; a key is added here and there together.
 *
 * `valuenow` and `valuetext` are never read: a value has one home,
 * `a11y.value`, where the sensitivity policy applies.
 */
import { safeGetAttribute, safeTagName } from "./clobber-safe.js";

/**
 * Attributes {@link getAriaProperties} reads, for the observer's
 * `attributeFilter`: an attribute the extractor reads but the observer does
 * not watch leaves a live tree stale. `min` and `max` are the HTML bounds of
 * `<input>`, `<meter>` and `<progress>`.
 */
export const ARIA_PROPERTY_ATTRIBUTES: readonly string[] = [
  "aria-valuemin",
  "aria-valuemax",
  "min",
  "max",
];

/** Roles that take authored `aria-valuemin`/`aria-valuemax`. */
const BOUNDED_ROLES: ReadonlySet<string> = new Set([
  "slider",
  "scrollbar",
  "separator",
  "spinbutton",
  "meter",
  "progressbar",
]);

/** Roles ARIA 1.2 gives an implicit 0 to 100 range. */
const DEFAULT_RANGE_ROLES: ReadonlySet<string> = new Set([
  "slider",
  "scrollbar",
  "separator",
  "meter",
  "progressbar",
]);

const DECIMAL = /^[+-]?(\d+(?:\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;
/** HTML's floating-point number grammar: no whitespace, no leading `+`. */
const HTML_NUMBER = /^-?(\d+(?:\.\d+)?|\.\d+)([eE][+-]?\d+)?$/;

/** A bound as a string key value, or `null` when unparsable or empty. */
function parseBound(raw: string | null, grammar = DECIMAL): string | null {
  if (raw === null) return null;
  // Decimal floating point only: `Number` would also take "0x10" and "0b1".
  // ARIA values are trimmed; an HTML attribute is not.
  if (!grammar.test(grammar === DECIMAL ? raw.trim() : raw)) return null;
  const n = Number(raw);
  // String(Number(raw)): "1e2" is "100" and "0.5" is "0.5", as native gives them.
  return Number.isFinite(n) ? String(n) : null;
}

/**
 * The effective HTML bounds of the elements that carry them, defaults and the
 * min-raises-max rule included, so an ARIA override of one bound never moves
 * the other. `null` where HTML says nothing.
 */
function htmlBounds(
  element: Element,
  tag: string,
  role: string,
): { min: string | null; max: string | null } {
  const attr = (name: string) =>
    parseBound(safeGetAttribute(element, name), HTML_NUMBER);
  const min = attr("min");
  const max = attr("max");
  // HTML raises an effective max that falls below the min, as Chromium does.
  const effective = (defMin: number, defMax: number) => {
    const lo = min === null ? defMin : Number(min);
    const hi = max === null ? defMax : Number(max);
    return { min: String(lo), max: String(Math.max(lo, hi)) };
  };
  if (tag === "input") {
    const type = (safeGetAttribute(element, "type") ?? "").toLowerCase();
    if (type === "range" && role === "slider") return effective(0, 100);
    if (type === "number" && role === "spinbutton") return { min, max };
  } else if (tag === "meter" && role === "meter") {
    return effective(0, 1);
  } else if (tag === "progress" && role === "progressbar") {
    // A progress bar always starts at 0, and its max defaults to 1, also
    // when it is indeterminate (HTML-AAM, and what Chromium reports).
    return { min: "0", max: max !== null && Number(max) > 0 ? max : "1" };
  }
  return { min: null, max: null };
}

/**
 * The range bounds of an element, as `valuemin`/`valuemax`.
 *
 * Precedence, per bound: the authored `aria-valuemin`/`aria-valuemax`, then
 * HTML `min`/`max` (ARIA in HTML tells authors not to write both, and
 * Chromium lets ARIA win), then the implicit default. The defaults are ARIA
 * 1.2's 0 and 100 for slider, scrollbar, a focusable separator, meter and
 * progressbar, and HTML's own for `<input type=range>`, `<meter>` and
 * `<progress>`. A `spinbutton` and `<input type=number>` get no default. An
 * unparsable or empty bound counts as absent.
 */
function rangeBounds(
  element: Element,
  role: string,
  focusable: boolean,
): Record<string, string> {
  if (!BOUNDED_ROLES.has(role)) return {};
  // ARIA 1.2 supports the bounds on a separator only when it is focusable.
  if (role === "separator" && !focusable) return {};
  const html = htmlBounds(element, safeTagName(element), role);
  const implicit = DEFAULT_RANGE_ROLES.has(role);
  const min =
    parseBound(safeGetAttribute(element, "aria-valuemin")) ??
    html.min ??
    (implicit ? "0" : null);
  const max =
    parseBound(safeGetAttribute(element, "aria-valuemax")) ??
    html.max ??
    (implicit ? "100" : null);
  const out: Record<string, string> = {};
  if (min !== null) out["valuemin"] = min;
  if (max !== null) out["valuemax"] = max;
  return out;
}

/**
 * The properties an element carries besides a heading's `level` and a media
 * element's `captions`, which `buildNode` still writes itself.
 */
export function getAriaProperties(
  element: Element,
  role: string,
  focusable: boolean,
): Record<string, string> {
  return { ...rangeBounds(element, role, focusable) };
}
