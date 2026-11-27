import { isAriaHiddenValue } from "./aria-tokens.js";
import { safeGetAttribute, safeNodeType } from "./clobber-safe.js";
import { ignoresChildText } from "./field-text.js";
import {
  flatChildNodes,
  isRenderedInFlatTree,
  renderingParent,
} from "./flat-tree.js";
import { isTextVisible } from "./name-spacing.js";
import { isSubtreeHidden } from "./role-map.js";

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

/** One node still to read, or where a block's text ends (for `lines`). */
type Pending =
  { node: Node; visible: boolean; whiteSpace: WhiteSpace } | "block-end";

/**
 * The text a read builds. Without `lines`, text as it stands; with it, line
 * by line, with white space treated as CSS treats it.
 */
class TextBuilder {
  private text = "";
  // With `lines`: a line break owed before any more text, and whether `text`
  // ends with a space that white space collapsing may still drop.
  private breakOwed = false;
  private looseSpace = false;

  constructor(private readonly lines: boolean) {}

  /** A text node's data. */
  textNode(data: string, whiteSpace: WhiteSpace): void {
    if (!this.lines) {
      this.text += data;
      return;
    }
    if (whiteSpace === "keep") {
      if (data === "") return;
      this.write(data);
      this.looseSpace = false;
      return;
    }
    let more =
      whiteSpace === "keep-breaks"
        ? data.replace(/[ \t\r]*\n[ \t\r]*/g, "\n").replace(/[ \t\r]+/g, " ")
        : data.replace(/[ \t\n\r]+/g, " ");
    // A space at the start of a line, or after another, is no space at all.
    const lineStart =
      this.breakOwed || this.text === "" || this.text.endsWith("\n");
    if (more.startsWith(" ") && (lineStart || this.looseSpace)) {
      more = more.slice(1);
    }
    if (more === "") return;
    this.write(more);
    this.looseSpace = more.endsWith(" ");
  }

  /** The edge of a block: one line break before any more text. */
  endLine(): void {
    this.dropLooseSpace();
    if (this.text !== "" && !this.text.endsWith("\n")) this.breakOwed = true;
  }

  /** A `<br>`. */
  lineBreak(): void {
    this.dropLooseSpace();
    this.write("\n");
  }

  /** The text, without a space left loose at its end. */
  finish(): string {
    this.dropLooseSpace();
    return this.text;
  }

  private write(more: string): void {
    if (this.breakOwed) this.text += "\n";
    this.breakOwed = false;
    this.text += more;
  }

  private dropLooseSpace(): void {
    if (this.looseSpace) this.text = this.text.slice(0, -1);
    this.looseSpace = false;
  }
}

/** What one {@link pageText} read carries through its walk. */
interface Walk {
  readonly announced: boolean;
  readonly lines: boolean;
  readonly out: TextBuilder;
  /** Where to note each text node the read takes text from, if anywhere. */
  readonly texts: Text[] | undefined;
  /** Which text nodes to read, if not all. */
  readonly keep: ((node: Text) => boolean) | undefined;
  /** An explicit stack, not recursion: a page's depth is the page's to choose. */
  readonly stack: Pending[];
}

/** Queue `parent`'s children in the flat tree, first child on top. */
function pushChildren(
  walk: Walk,
  parent: Node,
  style: CSSStyleDeclaration,
): void {
  const visible = isTextVisible(style);
  // Without `lines`, nothing reads how an element treats white space.
  const whiteSpace = walk.lines ? whiteSpaceOf(style) : "keep";
  const children = flatChildNodes(parent);
  for (let i = children.length - 1; i >= 0; i--) {
    walk.stack.push({ node: children[i]!, visible, whiteSpace });
  }
}

/** Read one node: a text node's data, or an element's children. */
function visit(
  walk: Walk,
  { node, visible, whiteSpace }: Exclude<Pending, "block-end">,
): void {
  const type = safeNodeType(node);
  if (type === Node.TEXT_NODE) {
    if (!visible) return;
    const data = (node as Text).data;
    if (walk.keep && !walk.keep(node as Text)) {
      // Its words left out, the white space at its edges kept: the words
      // either side of it stay apart, as the page shows them, and the space
      // between its own words goes with them.
      walk.out.textNode(data.replace(/\S([^]*\S)?/, ""), whiteSpace);
      return;
    }
    walk.out.textNode(data, whiteSpace);
    walk.texts?.push(node as Text);
    return;
  }
  if (type !== Node.ELEMENT_NODE) return;
  const element = node as Element;
  const style = getComputedStyle(element);
  if (skipsText(element, style, walk.announced)) return;
  if (walk.lines && element.localName === "br") {
    walk.out.lineBreak();
    return;
  }
  if (walk.lines && !inlineLevel(style)) {
    walk.out.endLine();
    walk.stack.push("block-end");
  }
  pushChildren(walk, element, style);
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
 *
 * With `texts`, also every text node the read takes text from, in order,
 * pushed onto that array: which nodes a region's text comes from, so a
 * reader can tell text shown anew from text it already showed.
 *
 * With `keep`, only the text nodes it accepts: the read leaves the others'
 * words out but keeps the page's layout around them, its line breaks and the
 * white space at their edges that keeps the words either side apart.
 *
 * @internal For reads of a page's text outside core: the extension's
 * live-region line and field state, and `testing`'s timeline. Not a
 * stability promise.
 */
export function pageText(
  root: Element,
  {
    announced = false,
    lines = false,
    texts,
    keep,
  }: {
    announced?: boolean;
    lines?: boolean;
    texts?: Text[];
    keep?: (node: Text) => boolean;
  } = {},
): string {
  const rootStyle = getComputedStyle(root);
  const unread = announced
    ? !announceable(root, rootStyle)
    : skipsText(root, rootStyle, false);
  if (unread) return "";

  const walk: Walk = {
    announced,
    lines,
    texts,
    keep,
    out: new TextBuilder(lines),
    stack: [],
  };
  pushChildren(walk, root, rootStyle);
  for (let entry = walk.stack.pop(); entry; entry = walk.stack.pop()) {
    if (entry === "block-end") walk.out.endLine();
    else visit(walk, entry);
  }
  return walk.out.finish();
}
