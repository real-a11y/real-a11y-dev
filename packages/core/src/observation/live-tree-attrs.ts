import { isSensitiveChoiceHost } from "../extraction/choice-withholding.js";
import {
  safeGetAttribute,
  safeMatches,
  safeTagName,
} from "../extraction/clobber-safe.js";
import {
  deepQuerySelectorAll,
  flatParentElement,
} from "../extraction/flat-tree.js";
import { getExplicitRole } from "../extraction/role-map.js";
import { isSensitiveField } from "../extraction/sensitivity.js";

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

/** The elements {@link isSensitiveField} can be true of. */
const FIELD_TAGS: ReadonlySet<string> = new Set([
  "input",
  "textarea",
  "select",
]);

/**
 * True when a change to `attr` on `target` moves which choices a sensitive
 * field withholds somewhere else: its popup listbox is not its descendant,
 * so neither re-extracting `target` nor its subtree reaches the options there.
 * That is a relation a sensitive field (or a combobox around one) gains or
 * loses (`aria-controls`; `aria-owns` is a reference attribute already); a
 * field becoming or ceasing to be sensitive (`autocomplete`, `type`) that
 * has such a relation or sits in a combobox with one; or an element around a
 * sensitive field, with a relation, becoming or ceasing to be a combobox
 * (`role`). What the element holds is re-read with it.
 */
export function movesSensitiveChoice(target: Element, attr: string): boolean {
  switch (attr) {
    case "aria-controls":
      return isSensitiveChoiceHost(target);
    case "autocomplete":
    case "type":
      return (
        FIELD_TAGS.has(safeTagName(target)) &&
        (hasPopupRelation(target) ||
          comboboxAtOrAbove(flatParentElement(target)))
      );
    case "role":
      return hasPopupRelation(target) && holdsSensitiveField(target);
    default:
      return false;
  }
}

/**
 * True when adding or removing `subtree` under `parent` moves which choices a
 * sensitive field withholds somewhere else: the subtree holds a sensitive
 * field (or a combobox around one) that controls or owns a popup, or a
 * sensitive field going into or out of a combobox that does. The popup is not in the subtree, so splicing the subtree alone
 * leaves its choice as it was read. Shadow roots in the subtree count.
 */
export function bringsSensitivePopup(
  subtree: Element,
  parent: Element | null,
): boolean {
  const all = (selectors: string): Element[] => [
    ...(safeMatches(subtree, selectors) ? [subtree] : []),
    ...deepQuerySelectorAll(subtree, selectors),
  ];
  if (all("[aria-controls], [aria-owns]").some(isSensitiveChoiceHost)) {
    return true;
  }
  return (
    all("input, textarea, select").some(isSensitiveField) &&
    comboboxAtOrAbove(parent)
  );
}

/** `element` or what it holds, shadow roots included, is a sensitive field. */
function holdsSensitiveField(element: Element): boolean {
  return (
    isSensitiveField(element) ||
    deepQuerySelectorAll(element, "input, textarea, select").some(
      isSensitiveField,
    )
  );
}

/**
 * Whether `start` or an element above it in the flat tree is a combobox, as
 * the tree reads the role, that names a popup in `aria-controls` or
 * `aria-owns`: the ARIA 1.1 wrapper around a field. One that holds its
 * listbox as a child needs no full read: the wrapper is the value owner of
 * the field inside it (`fieldValueOwner`), so it is re-read, listbox and all,
 * with the field. The climb reads parents through the prototype, so a
 * `<form>` met on the way can't shadow `parentElement` with a control of its
 * own.
 */
function comboboxAtOrAbove(start: Element | null): boolean {
  for (let el = start; el; el = flatParentElement(el)) {
    if (getExplicitRole(el) === "combobox" && hasPopupRelation(el)) return true;
  }
  return false;
}

function hasPopupRelation(element: Element): boolean {
  return (
    safeGetAttribute(element, "aria-controls") !== null ||
    safeGetAttribute(element, "aria-owns") !== null
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
