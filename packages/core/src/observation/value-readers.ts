/**
 * Where a live refresh must re-read a name because a field's value, or a
 * label, moved.
 *
 * A control the user adjusts lends its value to a name it sits in, and its own
 * name when it holds none (AccName 1.2 step 2C, `embeddedControlText` in
 * extraction/dom-extractor.ts): typing into `<label><input type="checkbox">
 * Flash the screen <input> times</label>` renames the checkbox, and choosing
 * in a `<select>` renames the heading around it. Neither name's own element
 * changes, so the refresh adds the hosts these values reach. A reference to a
 * control reads its `<label>` too, so a label's change adds what it labels.
 */
import { ariaOwner, withAriaOwnerIndex } from "../extraction/aria-owner.js";
import { inSensitiveChoice } from "../extraction/choice-withholding.js";
import {
  safeGetAttribute,
  safeGetElementById,
  safeParentElement,
  safeQuerySelectorAll,
  safeTagName,
} from "../extraction/clobber-safe.js";
import {
  getElementRefs,
  isNameBarrierElement,
  nativeStates,
} from "../extraction/dom-extractor.js";
import { validityInvalid } from "../extraction/field-states.js";
import {
  EMBEDDED_VALUE_ROLES,
  fieldValueOwner,
} from "../extraction/field-text.js";
import { idScope } from "../extraction/flat-tree.js";
import { LABELED_TAGS } from "../extraction/host-names.js";
import { getImplicitRole } from "../extraction/role-map.js";
import { withholdsState } from "../extraction/strict-mode.js";
import type { SemanticNode } from "../types.js";

/** `el` lends its value, or its name, to a name it sits in (AccName 2C). */
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
 * True while a climb for a name host has not reached the page's body.
 *
 * @internal
 */
export function withinBody(el: Element): boolean {
  const doc = el.ownerDocument;
  return el !== doc?.body && el !== doc?.documentElement;
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

/**
 * Add, when `label` changed, the controls it names: the one its `for` names,
 * else each it wraps (see `associatedLabels`, which reads it the same way).
 * A reference to such a control reads the label, and so does a name the
 * control lends itself to: an empty field lends its name (see
 * `embeddedControlText`), so that name host is added too. Returns whether
 * anything was added.
 */
export function addLabelledControls(
  label: Element,
  dirty: Set<Element>,
  hostOf: (el: Element) => Element,
): boolean {
  const before = dirty.size;
  const forId = safeGetAttribute(label, "for");
  // Built here, not at module scope: a call there survives tree-shaking in
  // every bundle that imports core, used or not.
  const labelable = [...LABELED_TAGS].join(",");
  const controls = forId
    ? [safeGetElementById(idScope(label), forId)]
    : [...safeQuerySelectorAll(label, labelable)].filter(
        (control) => control.closest("label") === label,
      );
  for (const control of controls) {
    if (!control) continue;
    dirty.add(control);
    if (lendsValue(control)) addReaders(control, dirty, hostOf);
  }
  return dirty.size !== before;
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

/**
 * Add every recorded checkbox, radio, `<select>` and `<option>` whose native
 * state no longer matches its node. Those states move without an attribute,
 * and often without an event, of their own: a click on one radio unchecks its
 * sibling, a script's `option.selected = true` fires nothing, a handler can
 * make a "select all" box indeterminate, and opening a picker fires nothing at
 * all, so it shows once anything else refreshes. It reads a property or two
 * per control, far cheaper than re-extracting them all.
 *
 * A field's validity, which `invalid` records, moves the same way: with a
 * script's `setCustomValidity()` or `.value`, and when a submission attempt
 * makes `:user-invalid` match. So every `<input>`, `<select>`, `<textarea>`
 * and `<button>` is checked for that too.
 *
 * A state strict mode withholds (a chosen option's `selected`) is never on the
 * node, so `seen` remembers it instead: comparing with the node would dirty
 * every chosen option on each refresh, and never comparing would miss a choice
 * made by script, which renames the name around its `<select>` (`[redacted]`
 * once it holds a choice). Call it after a full extraction too, with a set to
 * discard, so `seen` starts from what that extraction read.
 *
 * True when a withheld choice moved in a sensitive field's popup
 * (`inSensitiveChoice`): a radio there checked by a click, which fires no
 * mutation. Whether the popup holds a choice decides what every reference
 * into it reads and whether any node in it keeps a description, so the
 * caller reads the whole tree again rather than this control alone.
 */
export function addMovedNativeStates(
  domNodes: ReadonlyMap<string, SemanticNode>,
  redactInput: boolean,
  seen: WeakMap<Element, unknown>,
  dirty: Set<Element>,
): boolean {
  const refs = getElementRefs();
  let choiceMoved = false;
  // One `aria-owns` and controls index for every withholding check below.
  withAriaOwnerIndex(() => {
    for (const [id, node] of domNodes) {
      const tag = node.dom?.tagName;
      if (!tag || !STATE_READ_TAGS.has(tag)) continue;
      const el = refs.get(id);
      if (!el) continue;
      if (validityMoved(el, tag, node)) {
        dirty.add(el);
        continue;
      }
      if (tag === "textarea" || tag === "button") continue;
      const moved = nativeStateMoved(el, node, redactInput, seen);
      if (moved) dirty.add(el);
      if (moved === "withheld" && inSensitiveChoice(el)) choiceMoved = true;
    }
  });
  return choiceMoved;
}

/**
 * Whether a native state of `el` moved since `node` was read: `"shown"` for
 * one its node shows, `"withheld"` for one it withholds ({@link movedSince}),
 * or `false`. Only the first state that moved is read.
 */
function nativeStateMoved(
  el: Element,
  node: SemanticNode,
  redactInput: boolean,
  seen: WeakMap<Element, unknown>,
): "shown" | "withheld" | false {
  const tag = node.dom?.tagName ?? "";
  for (const [state, value] of Object.entries(
    nativeStates(el, tag, node.a11y.role),
  )) {
    const shown = node.a11y.states[state];
    // A state the node shows as read was not withheld, and has not
    // moved: the common case, decided without the withholding climb.
    if (state in node.a11y.states && value === shown) continue;
    if (withholdsState(el, node.a11y.role, state, redactInput)) {
      if (movedSince(el, value, seen)) return "withheld";
    } else if (value !== shown) {
      return "shown";
    }
  }
  return false;
}

/** The controls whose native state or validity can move unobserved. */
const STATE_READ_TAGS = new Set([
  "input",
  "select",
  "option",
  "textarea",
  "button",
]);

/**
 * True when `el` fails or passes constraint validation where its node says
 * otherwise. A field whose authored aria-invalid decides is skipped: a change
 * to that is a mutation the observer already reports.
 */
function validityMoved(el: Element, tag: string, node: SemanticNode): boolean {
  const fails = validityInvalid(el, tag);
  return fails !== null && (fails || undefined) !== node.a11y.states["invalid"];
}

/** Record `value` for `el`, and say whether it differs from the last one. */
function movedSince(
  el: Element,
  value: unknown,
  seen: WeakMap<Element, unknown>,
): boolean {
  const known = seen.has(el);
  const before = seen.get(el);
  seen.set(el, value);
  return known && before !== value;
}
