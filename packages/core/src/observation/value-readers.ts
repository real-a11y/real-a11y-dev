/**
 * Where a live refresh must re-read a name because a field's value moved.
 *
 * A control the user adjusts lends its value to a name it sits in (AccName 1.2
 * step 2C, `embeddedControlText` in extraction/dom-extractor.ts): typing into
 * `<label><input type="checkbox"> Flash the screen <input> times</label>`
 * renames the checkbox, and choosing in a `<select>` renames the heading
 * around it. Neither name's own element changes, so the refresh adds the
 * hosts these values reach.
 */
import { safeParentElement, safeTagName } from "../extraction/clobber-safe.js";
import { isNameBarrierElement } from "../extraction/dom-extractor.js";
import {
  EMBEDDED_VALUE_ROLES,
  fieldValueOwner,
} from "../extraction/field-text.js";
import { getImplicitRole } from "../extraction/role-map.js";

/** `el` lends its value to a name it sits in (AccName 2C). */
function lendsValue(el: Element): boolean {
  return EMBEDDED_VALUE_ROLES.has(getImplicitRole(el));
}

/**
 * True when a name-from-content walk keeps `el`'s content out of an enclosing
 * name, so a climb for the host whose name a change reaches stops there. A
 * barrier does, except a control that lends its value: a change inside it (an
 * option relabelled, a `<select>`'s choice) still reaches the name around it.
 */
export function closesName(el: Element): boolean {
  return isNameBarrierElement(el) && !lendsValue(el);
}

/**
 * Add, for each element in `dirty`, the field whose value a change there
 * moves (`fieldValueOwner`: a change deep in an editor or a `<select>`
 * changes that field's value without touching it), and for a field that
 * lends its value, the name host around it (`hostOf`) and the `<label>`
 * around it, whose control is named from it.
 */
export function addValueReaders(
  dirty: Set<Element>,
  hostOf: (el: Element) => Element,
): void {
  for (const el of Array.from(dirty)) {
    const field = fieldValueOwner(el) ?? el;
    dirty.add(field);
    if (!lendsValue(field)) continue;
    dirty.add(hostOf(field));
    for (let up = safeParentElement(field); up; up = safeParentElement(up)) {
      if (safeTagName(up) === "label") {
        dirty.add(up);
        break;
      }
    }
  }
}
