/**
 * Where a node's choice state says what a sensitive field holds, in the DOM
 * producer. The native producers apply the same rule to Chromium's tree:
 * `withholdSelection` in the browser package's native-tree.ts, and
 * `withholdInsideSensitive` in the extension. Both follow `aria-controls` and
 * `aria-owns` from a sensitive field through core's `fieldRelationTargets`.
 */
import { ariaOwner, controlledBySensitiveField } from "./aria-owner.js";
import { flatParentElement } from "./flat-tree.js";
import { isSensitiveField } from "./sensitivity.js";

/**
 * True when `element` sits inside a sensitive field ({@link isSensitiveField}),
 * or inside what one controls (`aria-controls`) or owns (`aria-owns`). Its
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
      if (isSensitiveField(el) || controlledBySensitiveField(el)) return true;
    }
  }
  return false;
}
