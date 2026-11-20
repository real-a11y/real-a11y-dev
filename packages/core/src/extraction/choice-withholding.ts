/**
 * Where a node's choice state says what a sensitive field holds, in the DOM
 * producer. The native producers apply the same rule to Chromium's tree:
 * `withholdSelection` in the browser package's native-tree.ts, and
 * `withholdInsideSensitive` in the extension. Both follow `aria-controls` and
 * `aria-owns` from a sensitive field through core's `fieldRelationTargets`.
 */
import { ariaOwner, sensitiveControlsIndex } from "./aria-owner.js";
import { safeGetAttribute, safeQuerySelectorAll } from "./clobber-safe.js";
import {
  deepQuerySelectorAll,
  flatParentElement,
  idScope,
} from "./flat-tree.js";
import { getExplicitRole } from "./role-map.js";
import { isSensitiveField, POPUP_CHOICE_ROLES } from "./sensitivity.js";

/**
 * True for an element whose popup holds a sensitive field's choice: the field
 * itself ({@link isSensitiveField}), or a combobox around one, the ARIA 1.1
 * pattern. Such a wrapper carries `aria-controls` or `aria-owns` for the
 * field inside it, or holds its listbox as a child; either way the choice
 * made there is the field's value. The field may sit in the wrapper's shadow
 * root, and the role is read as the tree reads it, so `role="x-combo
 * combobox"` is a combobox. The native producers' counterpart is core's
 * `sensitiveChoiceHosts`.
 */
export function isSensitiveChoiceHost(element: Element): boolean {
  if (isSensitiveField(element)) return true;
  if (getExplicitRole(element) !== "combobox") return false;
  return deepQuerySelectorAll(element, "input, textarea, select").some(
    isSensitiveField,
  );
}

/**
 * The ids that a sensitive field, or a combobox around one
 * ({@link isSensitiveChoiceHost}), names in `aria-controls` in `scope`.
 */
function sensitiveControlTargets(scope: Document | ShadowRoot): Set<string> {
  const ids = new Set<string>();
  for (const field of safeQuerySelectorAll(scope, "[aria-controls]")) {
    if (!isSensitiveChoiceHost(field)) continue;
    const controls = safeGetAttribute(field, "aria-controls") ?? "";
    for (const id of controls.trim().split(/\s+/)) if (id) ids.add(id);
  }
  return ids;
}

/**
 * True when a sensitive field, or a combobox around one, names `element` in
 * its `aria-controls`, in its id scope: an ARIA combobox's popup listbox,
 * which is not the field's descendant, but whose selected option is the
 * field's value. Cached per extraction (`sensitiveControlsIndex`).
 */
export function controlledBySensitiveField(element: Element): boolean {
  const id = safeGetAttribute(element, "id");
  if (!id) return false;
  const scope = idScope(element);
  const index = sensitiveControlsIndex();
  if (!index) return sensitiveControlTargets(scope).has(id);
  let ids = index.get(scope);
  if (!ids) {
    ids = sensitiveControlTargets(scope);
    index.set(scope, ids);
  }
  return ids.has(id);
}

/**
 * True when `element` sits inside a sensitive field (`isSensitiveField`),
 * or inside what one controls (`aria-controls`) or owns (`aria-owns`) — or
 * what an ARIA 1.1 combobox around one does, the wrapper that carries those
 * relations for the field inside it ({@link isSensitiveChoiceHost}). Its
 * `selected` state then says which choice the field holds, which is the value
 * the field's `[redacted]` withholds: an option of a payment `<select>`, and
 * one in the popup listbox an `<input role="combobox" autocomplete="cc-exp">`
 * controls, which is not the field's descendant.
 *
 * The climb reads the tree roles are computed in: flat-tree parents, then the
 * `aria-owns` owners met on the way, as strict mode's `inChoiceField` does.
 * Not only an option: Chromium carries `selected` on tabs, rows and grid
 * cells too, and the native producers withhold it on every node in such a
 * region, so this does as well.
 */
export function inSensitiveChoice(element: Element): boolean {
  const seen = new Set<Element>([element]);
  const pending: Element[] = [element];
  for (let start = pending.pop(); start; start = pending.pop()) {
    for (let el: Element | null = start; el; el = flatParentElement(el)) {
      const owner = ariaOwner(el);
      if (owner && !seen.has(owner)) {
        seen.add(owner);
        pending.push(owner);
      }
      if (el === element) continue;
      if (isSensitiveChoiceHost(el) || controlledBySensitiveField(el)) {
        return true;
      }
    }
  }
  return false;
}

/**
 * True when what `element`, in `role`, lends a name or description it is
 * embedded in (AccName 2C) gives a sensitive field's value or choice away: a
 * sensitive field, or a combobox around one ({@link isSensitiveChoiceHost});
 * or a listbox that holds one's choice, because a sensitive field controls
 * it, owns it, or holds it ({@link inSensitiveChoice}). `<label>Expiry month
 * <input autocomplete="cc-exp-month" aria-controls="lb"> <ul
 * id="lb">…</ul></label>` would otherwise name the field "Expiry month 03".
 * Only a choice container (`POPUP_CHOICE_ROLES`), as in the native
 * producers: an ordinary field in a panel a sensitive field controls still
 * lends its own value.
 */
export function lendsSensitiveChoice(element: Element, role: string): boolean {
  if (isSensitiveChoiceHost(element)) return true;
  return (
    POPUP_CHOICE_ROLES.has(role) &&
    (controlledBySensitiveField(element) || inSensitiveChoice(element))
  );
}
