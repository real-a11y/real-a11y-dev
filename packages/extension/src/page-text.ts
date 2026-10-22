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

/** How CSS treats the white space in an element's text (`white-space`). */
type WhiteSpace = "collapse" | "keep-breaks" | "keep";

function whiteSpaceOf(style: CSSStyleDeclaration): WhiteSpace {
  switch (style.whiteSpace) {
    case "pre":
    case "pre-wrap":
    case "break-spaces":
      return "keep";
    case "pre-line":
      return "keep-breaks";
    default:
      return "collapse";
  }
}

/** True if an element starts no line of its own: an inline box, such as a
 *  `<span>` or an inline-block, or no box at all (`display: contents`). */
function inlineLevel(style: CSSStyleDeclaration): boolean {
  const display = style.display;
  return display === "" || /^(?:inline|contents|ruby|math)/.test(display);
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
 *
 * With `lines`, line by line as the page lays it out: a `<br>` ends a line,
 * and so does the edge of a block — a paragraph, a `<div>`, a list item —
 * once, however many edges meet there; a `<br>` that ends a block adds no line
 * of its own. White space collapses where CSS collapses it, so the markup's
 * own indenting and line breaks go while a `pre-wrap` editor's stay. That is
 * an editor's text for an edit box that keeps line breaks; read without
 * `lines`, its paragraphs run together: `Dear Sam,Thanks!`.
 */
export function pageText(
  root: Element,
  {
    announced = false,
    lines = false,
  }: { announced?: boolean; lines?: boolean } = {},
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
  // With `lines`: a line break owed before any more text, and whether `text`
  // ends with a space that white space collapsing may still drop.
  let breakOwed = false;
  let looseSpace = false;
  const write = (more: string) => {
    if (breakOwed) text += "\n";
    breakOwed = false;
    text += more;
  };
  const endLine = () => {
    if (looseSpace) text = text.slice(0, -1);
    looseSpace = false;
    if (text !== "" && !text.endsWith("\n")) breakOwed = true;
  };
  const writeText = (data: string, whiteSpace: WhiteSpace) => {
    if (whiteSpace === "keep") {
      if (data === "") return;
      write(data);
      looseSpace = false;
      return;
    }
    let more =
      whiteSpace === "keep-breaks"
        ? data.replace(/[ \t\r]*\n[ \t\r]*/g, "\n").replace(/[ \t\r]+/g, " ")
        : data.replace(/[ \t\n\r]+/g, " ");
    // A space at the start of a line, or after another, is no space at all.
    const lineStart = breakOwed || text === "" || text.endsWith("\n");
    if (more.startsWith(" ") && (lineStart || looseSpace)) more = more.slice(1);
    if (more === "") return;
    write(more);
    looseSpace = more.endsWith(" ");
  };

  // An explicit stack, not recursion: a page's depth is the page's to choose.
  // `"block-end"` marks where a block's text ends, for `lines`.
  const stack: Array<
    { node: Node; visible: boolean; whiteSpace: WhiteSpace } | "block-end"
  > = [];
  const push = (parent: Node, visible: boolean, whiteSpace: WhiteSpace) => {
    const children = flatChildNodes(parent);
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ node: children[i]!, visible, whiteSpace });
    }
  };
  // Without `lines`, nothing reads how an element treats white space.
  const whiteSpaceFor = (style: CSSStyleDeclaration): WhiteSpace =>
    lines ? whiteSpaceOf(style) : "keep";
  push(root, isTextVisible(rootStyle), whiteSpaceFor(rootStyle));
  while (stack.length) {
    const entry = stack.pop()!;
    if (entry === "block-end") {
      endLine();
      continue;
    }
    const { node, visible, whiteSpace } = entry;
    const type = safeNodeType(node);
    if (type === Node.TEXT_NODE) {
      if (!visible) continue;
      if (lines) writeText((node as Text).data, whiteSpace);
      else text += (node as Text).data;
      continue;
    }
    if (type !== Node.ELEMENT_NODE) continue;
    const element = node as Element;
    const style = getComputedStyle(element);
    if (skipsText(element, style, announced)) continue;
    if (lines) {
      if (element.localName === "br") {
        if (looseSpace) text = text.slice(0, -1);
        looseSpace = false;
        write("\n");
        continue;
      }
      if (!inlineLevel(style)) {
        endLine();
        stack.push("block-end");
      }
    }
    push(element, isTextVisible(style), whiteSpaceFor(style));
  }
  if (lines && looseSpace) text = text.slice(0, -1);
  return text;
}
