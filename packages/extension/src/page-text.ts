import {
  flatChildNodes,
  ignoresChildText,
  isAriaHiddenValue,
  isRenderedInFlatTree,
  isSubtreeHidden,
  isTextVisible,
  renderingParent,
  safeGetAttribute,
  safeNodeType,
} from "@real-a11y-dev/core";

/**
 * True if nothing inside `element` reaches the page's text: its children are
 * not its text ({@link ignoresChildText} — a `<textarea>`'s are its markup
 * DEFAULT value, and for a sensitive field the secret itself; a `<video>`'s
 * are fallback content), or it renders nothing (`hidden`, `inert`,
 * `display: none`, which takes `<script>` and `<style>` with it), or — when
 * `announced` — it is `aria-hidden`. These are the skips core's field-text
 * walk makes for an editor's value, from the same predicates.
 *
 * Every read is clobber-safe, so a hostile `<form>` can't make it throw and
 * cost the read a region's text.
 */
function skipsText(
  element: Element,
  style: CSSStyleDeclaration | null,
  announced: boolean,
): boolean {
  // `localName` can't throw: only a <form> shadows it, and a form holds text.
  if (ignoresChildText(element.localName)) return true;
  if (
    announced &&
    isAriaHiddenValue(safeGetAttribute(element, "aria-hidden"))
  ) {
    return true;
  }
  return isSubtreeHidden(element, style);
}

/**
 * True if a screen reader could reach `element` at all: it is rendered in the
 * flat tree (assigned to a slot, not in a closed `<details>`' body), and
 * neither it nor anything rendering it is hidden or `aria-hidden`.
 */
function announceable(
  element: Element,
  style: CSSStyleDeclaration | null,
): boolean {
  if (!isRenderedInFlatTree(element)) return false;
  if (skipsText(element, style, true)) return false;
  for (let el = renderingParent(element); el; el = renderingParent(el)) {
    if (skipsText(el, getComputedStyle(el), true)) return false;
  }
  return true;
}

/**
 * The text `root` renders, read like `textContent` but in the flat tree — slots
 * and open shadow roots as rendered, a closed `<details>` as its summary — and
 * without what the page never shows as text (see {@link skipsText}) or text
 * under `visibility: hidden` (a child that sets `visible` again still reads).
 * Unlike core's field-text walk it neither caps nor collapses: a `log`
 * region's text has to keep changing past any cap, and an editor's text opens
 * the input panel that writes it back.
 *
 * With `announced`, also without `aria-hidden` subtrees, and empty unless
 * `root` itself could be announced (see {@link announceable}): what a screen
 * reader could say for a live region.
 */
export function pageText(
  root: Element,
  { announced = false }: { announced?: boolean } = {},
): string {
  const rootStyle = getComputedStyle(root);
  if (
    announced
      ? !announceable(root, rootStyle)
      : skipsText(root, rootStyle, false)
  ) {
    return "";
  }

  let text = "";
  // An explicit stack, not recursion: a page's depth is the page's to choose.
  const stack: Array<{ node: Node; visible: boolean }> = [];
  const push = (parent: Node, visible: boolean) => {
    const children = flatChildNodes(parent);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ node: children[i]!, visible });
    }
  };
  push(root, isTextVisible(rootStyle));
  while (stack.length) {
    const { node, visible } = stack.pop()!;
    const type = safeNodeType(node);
    if (type === Node.TEXT_NODE) {
      if (visible) text += (node as Text).data;
      continue;
    }
    if (type !== Node.ELEMENT_NODE) continue;
    const style = getComputedStyle(node as Element);
    if (skipsText(node as Element, style, announced)) continue;
    push(node, isTextVisible(style));
  }
  return text;
}
