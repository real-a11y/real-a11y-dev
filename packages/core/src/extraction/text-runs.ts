import { AUTHOR_NAMED_ROLES } from "./author-named-roles.js";
import {
  safeGetAttribute,
  safeGetAttributeNames,
  safeNodeType,
  safeTagName,
} from "./clobber-safe.js";
import { isEditable, isEditingHost } from "./editing.js";
import { flatChildNodes, flatParent } from "./flat-tree.js";
import {
  getCachedComputedStyle,
  getExplicitRole,
  getImplicitRole,
  isHiddenFromAT,
  type StyleCache,
} from "./role-map.js";
import { warnSkippedElement } from "./skipped-element.js";

/**
 * True if an element of `role` takes the text of its {@link isTextRun} children
 * as its own: every role the own-text step names except a `generic` (and a
 * presentational element, which no view keeps). A generic's name decides
 * whether the a11y view keeps it (`keepNode` in a11y-extractor.ts), so reading
 * through its wrappers would add a node for every `<div><span>…</span></div>`,
 * its text a copy of the span's below it. The words are not lost there: the
 * wrapper keeps its own node and name, as it does under a heading.
 */
export function readsTextRuns(role: string): boolean {
  return role !== "generic" && role !== "presentation";
}

/**
 * The element's own text as Chromium lays it out: its text-node children, and
 * the text of each child that is only a {@link isTextRun}, in document order.
 * A `<br>` reads as a space, as the native producer reads Chromium's
 * `LineBreak`. Any other child owns its text — a link, a `<code>`, a hidden
 * span — and lends none here, nor a separator: the native producer
 * concatenates the runs Chromium hangs on the element exactly as they are.
 */
export function getOwnText(
  element: Element,
  styleCache: StyleCache | null | undefined,
  readText: (node: Node) => string,
): string {
  let text = "";
  for (const child of flatChildNodes(element)) {
    const type = safeNodeType(child);
    if (type === Node.TEXT_NODE) {
      text += readText(child);
    } else if (type === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      // A child that cannot be read costs its own text, not the host's name —
      // as in getAccessibleTextContent.
      try {
        const style = getCachedComputedStyle(childEl, styleCache);
        // A hidden child adds nothing, not even a hidden `<br>`'s space:
        // Chromium hangs no `LineBreak` for it, so `A<br hidden>B` is "AB".
        if (isHiddenFromAT(childEl, style)) continue;
        if (safeTagName(childEl) === "br") {
          text += " ";
        } else if (isTextRun(childEl, style)) {
          text += getOwnText(childEl, styleCache, readText);
        }
      } catch (error) {
        warnSkippedElement(childEl, error);
      }
    }
  }
  return text;
}

/**
 * Tags that extract as `generic` but that Chromium still gives a node of its
 * own (`LabelText`, `Abbr`, `Ruby`, `Canvas`, `PluginObject`…), so their text
 * is theirs, not the line's. Measured over CDP: `<p>A <label>w</label> B</p>`
 * is paragraph "A B" there. A `<canvas>`' or `<object>`'s children are its
 * fallback, which a loaded `<object>` never even renders. An `<a>` with no
 * href is not here: Chromium reads it as a plain run.
 */
const OWN_NODE_GENERIC_TAGS = new Set([
  "abbr",
  "canvas",
  "label",
  "legend",
  "object",
  "q",
  "rp",
  "rt",
  "ruby",
  "summary",
]);

/**
 * True if `element` is only a run of its parent's text: a role-less inline
 * wrapper, which Chromium leaves out of its tree so that the text inside it
 * hangs straight off the element around it. A `<span>`, a `<b>`, a custom
 * element, an unknown tag (`<semanticnavigator>`, what v-html makes of a
 * literal `<SemanticNavigator />`), a `role="none"` — and the same with a
 * class, a style, a `data-*` or a `dir`.
 *
 * Measured against Chromium 153, a wrapper gets a node — and keeps its text —
 * when anything could name it (a `title`, any `aria-*`), focus it (`tabindex`,
 * an `onclick`, an editing host), point at it (`id`) or needs it (`lang`), when
 * its role is anything but generic or none (an explicit `role="generic"`
 * included; an empty or unknown token is no role), and when it has a box of
 * its own: `display: block`, `flex` or `inline-table`, or a float or an
 * absolutely positioned one, which CSS blockifies. Inline boxes — `inline`,
 * `inline-block`, `inline-flex`, `ruby` — and `display: contents` are runs. A
 * hidden one contributes nothing at all, which {@link getOwnText} decides
 * before it asks.
 *
 * The live extractor's climb asks {@link textRunHost} instead, which reads
 * only what an attribute change can't flip.
 */
function isTextRun(
  element: Element,
  style: CSSStyleDeclaration | null,
): boolean {
  if (!mayBeTextRun(element, getImplicitRole(element), style)) return false;
  if (getExplicitRole(element) === "generic") return false;
  // Clobber-safe: an inline `<form>` in a list item gets this far.
  for (const name of safeGetAttributeNames(element)) {
    if (
      name === "id" ||
      name === "lang" ||
      name === "tabindex" ||
      name === "onclick" ||
      name.startsWith("aria-") ||
      (name === "title" && safeGetAttribute(element, "title") !== "")
    ) {
      return false;
    }
  }
  return !isEditable(element);
}

/**
 * What {@link isTextRun} reads that no attribute of the element's own can
 * flip, short of a `role` or a restyle: a tag Chromium leaves out of its tree,
 * a role that is generic or none, and an inline box (or none at all, once it is
 * hidden).
 */
function mayBeTextRun(
  element: Element,
  role: string,
  style: CSSStyleDeclaration | null,
): boolean {
  if (OWN_NODE_GENERIC_TAGS.has(safeTagName(element))) return false;
  if (role !== "generic" && role !== "presentation") return false;
  // No computed style to read: a tag alone can't tell a `<span>` from a
  // `<div>`, so keep the element's text its own, as before.
  const display = style?.display;
  if (!display) return false;
  return (
    display === "contents" ||
    display === "none" ||
    display.startsWith("ruby") ||
    (display.startsWith("inline") && display !== "inline-table")
  );
}

/**
 * The element whose own text may hold `element`'s — its parent, when `element`
 * may be a {@link isTextRun} there and the own-text step names the parent from
 * its runs — for the live extractor's climb. A text change inside a `<span>`
 * changes the paragraph around it, and so can an attribute that makes the span
 * a node of its own (an `aria-label`, an `id`), which is why this reads only
 * what such an attribute leaves alone: it must hold before the change as well
 * as after. A parent the step never names (a landmark, an editor) is no host,
 * so a span loose in `<main>` doesn't re-extract the page.
 *
 * The one change it misses is a restyle that turns an inline run into a block:
 * the paragraph keeps the text until it is next re-extracted. Reading through
 * blocks too would close that, at the cost of re-extracting a list item, and
 * every list nested in it, each time a class changes on a row inside it.
 */
export function textRunHost(element: Element): Element | null {
  const parent = flatParent(element);
  if (!parent) return null;
  const parentRole = getImplicitRole(parent);
  if (
    !readsTextRuns(parentRole) ||
    AUTHOR_NAMED_ROLES.has(parentRole) ||
    isEditingHost(parent)
  ) {
    return null;
  }
  return mayBeTextRun(
    element,
    getImplicitRole(element),
    getCachedComputedStyle(element),
  )
    ? parent
    : null;
}
