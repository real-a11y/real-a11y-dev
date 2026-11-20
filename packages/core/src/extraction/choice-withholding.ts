/**
 * Where a node's choice state says what a sensitive field holds, in the DOM
 * producer. The native producers apply the same rule to Chromium's tree:
 * `withholdSelection` in the browser package's native-tree.ts, and
 * `withholdInsideSensitive` in the extension. Both follow `aria-controls` and
 * `aria-owns` from a sensitive field through core's `fieldRelationTargets`.
 */
import { ariaOwner, controlledBySensitiveField } from "./aria-owner.js";
import { flatParentElement } from "./flat-tree.js";
import { isSensitiveChoiceHost } from "./sensitivity.js";

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
 * True when what `element` lends a name or description it is embedded in
 * (AccName 2C) gives a sensitive field's value or choice away: a sensitive
 * field, or an ARIA 1.1 combobox around one ({@link isSensitiveChoiceHost}),
 * whose value is its owned listbox's chosen option; or a listbox that holds
 * one's choice, because a sensitive field controls it, owns it, or holds it
 * ({@link inSensitiveChoice}). `<label>Expiry month <input
 * autocomplete="cc-exp-month" aria-controls="lb"> <ul id="lb">…</ul></label>`
 * would otherwise name the field "Expiry month 03".
 */
export function lendsSensitiveChoice(element: Element): boolean {
  return (
    isSensitiveChoiceHost(element) ||
    controlledBySensitiveField(element) ||
    inSensitiveChoice(element)
  );
}
