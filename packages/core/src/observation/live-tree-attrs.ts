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
