import {
  holdsSensitiveField,
  inSensitiveChoice,
  isChosen,
  isSensitiveChoiceHost,
  pageMayHoldSensitiveField,
} from "../extraction/choice-withholding.js";
import {
  safeGetAttribute,
  safeMatches,
  safeShadowRoot,
  safeTagName,
} from "../extraction/clobber-safe.js";
import {
  deepQuerySelectorAll,
  flatParentElement,
} from "../extraction/flat-tree.js";
import { getExplicitRole, resolveRoleToken } from "../extraction/role-map.js";
import {
  FIELD_SELECTOR,
  FIELD_TAGS,
  isSensitiveField,
} from "../extraction/sensitivity.js";

/**
 * Attributes whose change creates or breaks accessibility references.
 * These are handled with a full re-extraction in the initial implementation
 * because tracking old/new reference targets safely is non-trivial.
 */
export const REFERENCE_ATTRS = new Set([
  "id",
  "aria-labelledby",
  "aria-describedby",
  "for",
  // An <img usemap> decides whether the areas of the map it names are
  // rendered, and that map can sit anywhere in the tree.
  "usemap",
  // An owner can be the required context that keeps an owned listitem,
  // option or treeitem its role, and the owned element can be anywhere.
  "aria-owns",
]);

/**
 * True when a change to `attr` on `target` moves which choices a sensitive
 * field withholds somewhere else: its popup listbox is not its descendant,
 * so neither re-extracting `target` nor its subtree reaches the options there.
 * That is a relation a sensitive field (or a combobox around one) gains or
 * loses (`aria-controls`, `aria-activedescendant`; `aria-owns` is a reference
 * attribute already); a field becoming or ceasing to be sensitive
 * (`autocomplete`, `type`) that has such a relation or sits in a combobox; an
 * element around a sensitive field becoming or ceasing to be a combobox
 * (`role`, read now and from `oldValue`, which an observer that recorded none
 * leaves `undefined`), relation or not, since a listbox it holds is its
 * popup, or a sensitive field's own role changing, or a name (`aria-label`,
 * `title`) coming or going on an element whose role list names a combobox
 * behind a token that needs one; or a
 * choice made or cleared in a sensitive field's popup (`aria-selected`),
 * which decides what every reference into the popup reads, the other
 * options' own names and descriptions among them.
 */
export function movesSensitiveChoice(
  target: Element,
  attr: string,
  oldValue?: string | null,
): boolean {
  switch (attr) {
    case "aria-controls":
    case "aria-activedescendant":
      return isSensitiveChoiceHost(target);
    case "autocomplete":
    case "type":
      return (
        FIELD_TAGS.has(safeTagName(target)) &&
        (hasPopupRelation(target) ||
          comboboxAtOrAbove(flatParentElement(target)))
      );
    case "role":
      return (
        isSensitiveField(target) ||
        (mayBeCombobox(target, oldValue) && wrapsSensitiveField(target))
      );
    case "aria-selected":
      return inSensitiveChoice(target);
    // A name can decide the role: an unnamed `region` token is skipped, so
    // `role="region combobox"` turns into a combobox when its name goes.
    case "aria-label":
    case "title":
      return (
        namesCombobox(safeGetAttribute(target, "role")) &&
        wrapsSensitiveField(target)
      );
    default:
      return false;
  }
}

/**
 * `target`, whose `role` changed from `oldValue`, is or was a combobox. An
 * observer that recorded no old value leaves it `undefined`: it may have been.
 */
function mayBeCombobox(
  target: Element,
  oldValue: string | null | undefined,
): boolean {
  return (
    getExplicitRole(target) === "combobox" ||
    oldValue === undefined ||
    namesCombobox(oldValue)
  );
}

/** `target` holds a sensitive field, on a page that holds any. */
function wrapsSensitiveField(target: Element): boolean {
  return pageMayHoldSensitiveField(target) && holdsSensitiveField(target);
}

/**
 * True when adding or removing `subtree` under `parent` moves which choices a
 * sensitive field withholds somewhere else: the subtree holds a sensitive
 * field (or a combobox around one) with a relation to a popup, or a sensitive
 * field going into or out of a combobox, slotted ones included; or it brings
 * a choice into, or takes one out of, a sensitive field's popup. The popup is
 * not in the subtree, or what references it is not, so splicing the subtree
 * alone leaves its choice as it was read. Shadow roots in the subtree count.
 */
export function bringsSensitivePopup(
  subtree: Element,
  parent: Element | null,
): boolean {
  // One walk, shadow roots included, for all three questions.
  const selectors = `[aria-controls], [aria-owns], [aria-activedescendant], [aria-selected], option, ${FIELD_SELECTOR}`;
  const found = [
    ...(safeMatches(subtree, selectors) ? [subtree] : []),
    ...deepQuerySelectorAll(subtree, selectors),
  ];
  if (found.some((el) => hasPopupRelation(el) && isSensitiveChoiceHost(el))) {
    return true;
  }
  // A slotted field's flat parent is its slot, in the host's shadow tree; one
  // that left a shadow host may have left a combobox in there.
  if (
    found.some(isSensitiveField) &&
    (comboboxAtOrAbove(flatParentElement(subtree) ?? parent) ||
      (parent !== null && safeShadowRoot(parent) !== null))
  ) {
    return true;
  }
  // A choice arriving where it lands, or where `aria-owns` pulls it in.
  const chosen = found.filter(isChosen);
  return (
    chosen.length > 0 &&
    ((parent !== null &&
      (isSensitiveChoiceHost(parent) || inSensitiveChoice(parent))) ||
      chosen.some(inSensitiveChoice))
  );
}

/**
 * Whether `start` or an element above it in the flat tree is a combobox, as
 * the tree reads the role: the ARIA 1.1 wrapper around a field, which names
 * its listbox in `aria-controls` / `aria-owns` or holds it as a child. Held,
 * the listbox is re-read with the wrapper, the field's value owner, but a
 * name elsewhere that references it is not: only a full read reaches that.
 * The climb reads parents through the prototype, so a `<form>` met on the way
 * can't shadow `parentElement` with a control of its own.
 */
function comboboxAtOrAbove(start: Element | null): boolean {
  for (let el = start; el; el = flatParentElement(el)) {
    if (getExplicitRole(el) === "combobox") return true;
  }
  return false;
}

/**
 * `role` may have made the element a combobox: any token resolves to one. A
 * token before it can be skipped (an unnamed `region`), so the first one the
 * tree recognizes is not enough to rule it out.
 */
function namesCombobox(role: string | null): boolean {
  return (role ?? "")
    .trim()
    .split(/\s+/)
    .some((token) => token !== "" && resolveRoleToken(token) === "combobox");
}

function hasPopupRelation(element: Element): boolean {
  return (
    safeGetAttribute(element, "aria-controls") !== null ||
    safeGetAttribute(element, "aria-owns") !== null ||
    safeGetAttribute(element, "aria-activedescendant") !== null
  );
}

/**
 * True when a change to `attr` costs a full re-extraction: a reference
 * attribute ({@link REFERENCE_ATTRS}), and in strict mode `contenteditable`.
 * A region that becomes an editor (or stops being one) withholds its text
 * from every name that reads it, a referrer to an id anywhere inside it
 * included, which no splice of the region reaches.
 */
export function forcesFullExtraction(
  attr: string,
  redactInput: boolean,
): boolean {
  return (
    REFERENCE_ATTRS.has(attr) || (redactInput && attr === "contenteditable")
  );
}

/**
 * Attributes whose change can move the extraction *scope* — either by creating
 * or destroying a modal/overlay candidate (`aria-modal`, `role`, `open`) or by
 * flipping one's visibility, its own or an ancestor's (`class`, `style`,
 * `hidden`, `inert`), since `findActiveModal`/`findPortalOverlay` both gate on
 * visibility. `aria-hidden` and `inert` also decide whether an overlay is
 * reachable by AT at all, which `findPortalOverlay` checks up the ancestor
 * chain: a portal that gains `aria-hidden` must un-pivot.
 *
 * A hit here does NOT force a full extraction. It only arms ONE
 * `resolveEffectiveRoot()` recomputation for the whole batch; the full
 * extraction happens only if the scope actually moved.
 *
 * Deciding from the mutated element alone would be both too narrow and far too
 * broad. Too narrow: the common Vue-Teleport / Angular-CDK pattern hides an
 * overlay by toggling `display` on a ROLELESS wrapper, and `isActuallyVisible`
 * consults the whole ancestor chain — a wrapper matches no overlay selector, so
 * the rescope would be missed. Too broad: an open menu repositioned by Floating
 * UI rewrites inline `style` on the `[role="menu"]` element every scroll frame
 * without the scope ever changing, and each of those would have forced a
 * full-page walk.
 */
export const SCOPE_ATTRS = new Set([
  "aria-modal",
  "role",
  "open",
  "class",
  "style",
  "hidden",
  "inert",
  "aria-hidden",
  // Hides the element until it shows as a popover, and shows it again when
  // removed from a closed one.
  "popover",
]);

/**
 * Attributes that can change whether an image is rendered, or hidden from AT,
 * from the image itself or from anywhere above it. An image map's areas are
 * rendered only while the image using their map is (see image-map.ts), and
 * that map can sit anywhere in the tree, so re-extracting what changed would
 * leave its areas as they were.
 */
export const IMAGE_RENDERING_ATTRS = new Set([
  "class",
  "style",
  "hidden",
  "inert",
  "open", // a closed <details> hides the image
  "aria-hidden",
]);
