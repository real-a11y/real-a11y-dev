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
import { ariaOwner, withAriaOwnerIndex } from "../extraction/aria-owner.js";
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

/** The `aria-owns` owner of `el` or of an element around it, if any. */
function ownedBy(el: Element): Element | null {
  for (let up: Element | null = el; up; up = safeParentElement(up)) {
    const owner = ariaOwner(up);
    if (owner) return owner;
  }
  return null;
}

/**
 * Add, for each element in `dirty`, the field whose value a change there
 * moves (`fieldValueOwner`: a change deep in an editor or a `<select>`
 * changes that field's value without touching it), and for a field that
 * lends its value, the name host around it (`hostOf`) and the `<label>`
 * around it, whose control is named from it. A change in an option a listbox
 * owns from elsewhere (`aria-owns`) reaches that listbox, which no DOM
 * ancestor of the option is.
 */
export function addValueReaders(
  dirty: Set<Element>,
  hostOf: (el: Element) => Element,
): void {
  withAriaOwnerIndex(() => {
    for (const el of Array.from(dirty)) {
      const owner = ownedBy(el);
      for (const start of owner ? [el, owner] : [el]) {
        const field = fieldValueOwner(start) ?? start;
        dirty.add(field);
        if (lendsValue(field)) addReaders(field, dirty, hostOf);
      }
    }
  });
}

/** The name host and the `<label>` a lending `field`'s value reaches. */
function addReaders(
  field: Element,
  dirty: Set<Element>,
  hostOf: (el: Element) => Element,
): void {
  dirty.add(hostOf(field));
  for (let up = safeParentElement(field); up; up = safeParentElement(up)) {
    if (safeTagName(up) === "label") {
      dirty.add(up);
      return;
    }
  }
}
