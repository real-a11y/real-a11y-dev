/**
 * What a node records of its element's attributes: `dom.attributes`. The
 * list, and the one read of it, apart from the walk so strict mode's rule for
 * what is never read sits beside what is.
 */
import { safeGetAttribute, safeTagName } from "./clobber-safe.js";
import { getImplicitRole } from "./role-map.js";
import { isSensitiveField, REDACTED_VALUE } from "./sensitivity.js";
import { withheldAttributes, withholdsState } from "./strict-mode.js";

/**
 * Attributes recorded verbatim on every node's `dom.attributes`.
 *
 * Exported because `DomObserver` builds its `attributeFilter` from this list:
 * an attribute the extractor reads but the observer doesn't watch produces a
 * node that silently goes stale, since an in-place flip yields no other
 * mutation to fall back on.
 */
export const KEY_ATTRIBUTES = [
  "id",
  "class",
  "href",
  "src",
  "type",
  "name",
  "role",
  "aria-label",
  "aria-expanded",
  "aria-hidden",
  "aria-checked",
  "aria-disabled",
  "aria-required",
  "aria-controls",
  "aria-haspopup",
  // Range values. Required props on slider/scrollbar/meter/progressbar, and
  // carried by nothing else: `A11yInfo.properties` has no `valuenow`, and the
  // DOM producer writes only `level` and `captions` into it, so without these an authored slider could not be reported as satisfied no
  // matter what the author wrote.
  "aria-valuenow",
  "aria-valuemin",
  "aria-valuemax",
  "alt",
  "title",
  "for",
  "action",
  "method",
  "placeholder",
  "tabindex",
  // A <select>'s display size: more than one row makes it a listbox, with no
  // expanded state. The testing matcher reads them back to tell a redundant
  // authored role, and the observer must see them flip, or a live tree keeps
  // the old role and state.
  "size",
  "multiple",
  // Media a11y signals (boolean attributes render as "")
  "controls",
  "autoplay",
  "muted",
  "loop",
  "poster",
];

/**
 * `element`'s `checked` is withheld from its node (`withholdsState`): a
 * choice item in a sensitive field's popup, so its `aria-checked` is too.
 */
function withholdsChecked(element: Element, redactInput: boolean): boolean {
  return withholdsState(
    element,
    getImplicitRole(element),
    "checked",
    redactInput,
  );
}

/** The {@link KEY_ATTRIBUTES} `element` carries, minus `withheld`. */
function readKeyAttributes(
  element: Element,
  withheld: ReadonlySet<string> | undefined,
  redactInput: boolean,
): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const name of KEY_ATTRIBUTES) {
    if (withheld?.has(name)) continue;
    const val = safeGetAttribute(element, name);
    if (val === null) continue;
    // The markup says what a withheld `checked` would: which item is chosen.
    if (name === "aria-checked" && withholdsChecked(element, redactInput)) {
      continue;
    }
    attrs[name] = val;
  }
  return attrs;
}

/**
 * Get key attributes for display. In strict mode, minus what
 * {@link withheldAttributes} keeps out, which is never read; and always
 * minus the `aria-checked` of a node whose `checked` is withheld.
 */
export function getKeyAttributes(
  element: Element,
  redactInput: boolean,
): Record<string, string> {
  const withheld = redactInput ? withheldAttributes(element) : undefined;
  const attrs = readKeyAttributes(element, withheld, redactInput);

  // Read current value from DOM property (not HTML attribute) for form controls
  // getAttribute("value") returns the initial value; .value reflects user input
  const tag = safeTagName(element);
  const readsValue = tag === "input" || tag === "textarea" || tag === "select";
  if (readsValue && !withheld?.has("value")) {
    // Guarded: a page can make the `.value` getter throw, and this runs inside
    // `buildNode`'s one try — an unguarded read cost the page the whole node.
    let currentValue = "";
    try {
      currentValue = (element as HTMLInputElement).value;
    } catch {
      // No readable value: record none.
    }
    if (currentValue) {
      attrs["value"] = isSensitiveField(element)
        ? REDACTED_VALUE
        : currentValue;
    }
  }

  return attrs;
}
