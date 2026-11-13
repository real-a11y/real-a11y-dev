/**
 * Whether CSS `visibility` hides an element. AccName 1.2 §4.3.2 step 2A lists
 * `collapse` beside `hidden`, and Chromium drops both. Per element only: the
 * value is inherited and a child can set `visible` again, so it never hides a
 * subtree.
 */
export function isHiddenByVisibility(
  value: string | null | undefined,
): boolean {
  return value === "hidden" || value === "collapse";
}

/** `isHiddenByVisibility` for the element's computed value, else its inline one. */
export function isOwnVisibilityHidden(
  element: Element,
  computed: CSSStyleDeclaration | null,
): boolean {
  return isHiddenByVisibility(
    computed ? computed.visibility : (element as HTMLElement).style?.visibility,
  );
}
