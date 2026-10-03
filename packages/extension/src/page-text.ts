import {
  CONTROL_TEXT_TAGS,
  flatChildNodes,
  isAriaHiddenValue,
  isRenderedInFlatTree,
  isSubtreeHidden,
  renderingParent,
} from "@real-a11y-dev/core";

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;

// Captured once, and read through the prototype: a `<form>` whose control is
// named `nodeType` or `getAttribute` shadows its own.
const nodeTypeOf = Object.getOwnPropertyDescriptor(
  Node.prototype,
  "nodeType",
)!.get!;
const getAttribute = Element.prototype.getAttribute;

/**
 * True if nothing inside `element` reaches the page's text: it is a control
 * ({@link CONTROL_TEXT_TAGS} — a `<textarea>`'s child text is its markup
 * DEFAULT value, and for a sensitive field the secret itself), or it renders
 * nothing (`hidden`, `inert`, `display: none`, which takes `<script>` and
 * `<style>` with it), or — when `announced` — it is `aria-hidden`.
 *
 * Every read is clobber-safe, core's included, so a hostile `<form>` can't make
 * it throw and cost the read a region's text.
 */
function unread(
  element: Element,
  style: CSSStyleDeclaration | null,
  announced: boolean,
): boolean {
  // `localName` can't throw: only a <form> shadows it, and no form is a control.
  if (CONTROL_TEXT_TAGS.has(element.localName)) return true;
  if (
    announced &&
    isAriaHiddenValue(getAttribute.call(element, "aria-hidden"))
  ) {
    return true;
  }
  return isSubtreeHidden(element, style);
}

/** `visibility` is inherited and overridable, so it hides text, not subtrees. */
function textVisible(style: CSSStyleDeclaration | null): boolean {
  return style?.visibility !== "hidden" && style?.visibility !== "collapse";
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
  if (unread(element, style, true)) return false;
  for (let el = renderingParent(element); el; el = renderingParent(el)) {
    if (unread(el, getComputedStyle(el), true)) return false;
  }
  return true;
}

/**
 * The text `root` renders, read like `textContent` but in the flat tree — slots
 * and open shadow roots as rendered, a closed `<details>` as its summary — and
 * without what the page never shows as text: a control's child text, a subtree
 * that renders nothing, and text under `visibility: hidden` (a child that sets
 * `visible` again still reads). Core's field-text walk reads an editor's
 * value much the same way, before collapsing and capping it.
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
    announced ? !announceable(root, rootStyle) : unread(root, rootStyle, false)
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
  push(root, textVisible(rootStyle));
  while (stack.length) {
    const { node, visible } = stack.pop()!;
    const type = nodeTypeOf.call(node);
    if (type === TEXT_NODE) {
      if (visible) text += (node as Text).data;
      continue;
    }
    if (type !== ELEMENT_NODE) continue;
    const style = getComputedStyle(node as Element);
    if (unread(node as Element, style, announced)) continue;
    push(node, textVisible(style));
  }
  return text;
}
