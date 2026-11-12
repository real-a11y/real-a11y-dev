import { warnOutsideProduction } from "../utils/warn.js";

/**
 * Report — outside production — that an element was skipped mid-extraction.
 *
 * The walk wraps each element so a single pathological node (usually DOM
 * clobbering that slipped past the targeted guards) degrades to "skip this
 * node" instead of aborting the whole tree. That silent recovery is the right
 * runtime behavior, but the gap should stay debuggable, so we surface the
 * element and the error for inspection.
 *
 * @internal
 */
export function warnSkippedElement(element: Element, error: unknown): void {
  warnOutsideProduction(
    "[real-a11y] Skipped an element during extraction to keep the rest of the tree intact:",
    element,
    error,
  );
}
