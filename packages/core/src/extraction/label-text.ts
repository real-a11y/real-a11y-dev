/**
 * The name a label that contains its control gives it.
 *
 * HTML-AAM excludes the control's own value, so the label's child nodes are
 * read minus the control itself. Another control the user adjusts lends its
 * value (AccName 2C) and any other form control nothing. aria-hidden and
 * hidden children are skipped. How a child is read is the caller's, so this
 * stays free of the name walk it sits inside.
 */
import { isAriaHiddenValue } from "./aria-tokens.js";
import { safeGetAttribute, safeNodeType, safeTagName } from "./clobber-safe.js";
import { isOpaqueNameChild, isTextVisible } from "./name-spacing.js";
import {
  getCachedComputedStyle,
  isSubtreeHidden,
  type StyleCache,
} from "./role-map.js";

const FORM_CONTROL_TAGS = new Set(["input", "select", "textarea"]);

export interface LabelReaders {
  /** A text node of the label's own — the name walk's, so strict mode holds. */
  readText: (node: Node) => string;
  /**
   * What a control embedded in the label lends it (AccName 2C), read ahead of
   * its own alternative, which step 2D ignores; `null` when it isn't one.
   */
  readEmbedded: (child: Element) => string | null;
  /**
   * `textVisible` is `false` for a `visibility: hidden` child, which lends no
   * alternative of its own, and `null` under a hidden label, which is read
   * whole as it always was.
   */
  readChild: (child: Element, textVisible: boolean | null) => string;
  onUnreadable: (child: Element, error: unknown) => void;
}

/**
 * What a control in the label lends it: one the user adjusts its value, any
 * other form control nothing. `null` when `child` is no control.
 */
function controlText(
  child: Element,
  readEmbedded: LabelReaders["readEmbedded"],
): string | null {
  const embedded = readEmbedded(child);
  if (embedded !== null) return embedded;
  return FORM_CONTROL_TAGS.has(safeTagName(child)) ? "" : null;
}

export function wrappingLabelText(
  label: Element,
  control: Element,
  styleCache: StyleCache | null | undefined,
  { readText, readEmbedded, readChild, onUnreadable }: LabelReaders,
): string {
  const parts: string[] = [];
  const labelShows = isTextVisible(getCachedComputedStyle(label, styleCache));
  for (const child of label.childNodes) {
    const type = safeNodeType(child);
    if (type === Node.TEXT_NODE) {
      const text = readText(child).trim();
      if (text) parts.push(text);
    } else if (type === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      if (childEl === control) continue;
      // An unreadable child costs its own text, not the control's name.
      try {
        if (isAriaHiddenValue(safeGetAttribute(childEl, "aria-hidden")))
          continue;
        const style = getCachedComputedStyle(childEl, styleCache);
        if (isSubtreeHidden(childEl, style)) continue;
        const shows = labelShows ? isTextVisible(style) : null;
        // A hidden widget or barrier is not read into, as in a name walk.
        if (shows === false && isOpaqueNameChild(childEl)) continue;
        const text = (
          controlText(childEl, readEmbedded) ?? readChild(childEl, shows)
        ).trim();
        if (text) parts.push(text);
      } catch (error) {
        onUnreadable(childEl, error);
      }
    }
  }
  return parts.join(" ");
}

/**
 * Every label of `control` in tree order: the `<label for>` elements that name
 * its id, plus the label that wraps it. A label with a `for` belongs to the
 * control that id names, wrapping or not, so a wrapper pointing elsewhere is
 * left out. `wrappingLabel` is the one that holds the control, if any.
 */
export function associatedLabels(
  control: Element,
  forLabels: readonly Element[],
): { labels: Element[]; wrappingLabel: Element | null } {
  const labels = [...forLabels];
  const closest = control.closest("label");
  const id = control.getAttribute("id");
  // A label with no `for` labels its first labelable descendant only. Held for
  // output, meter and progress, so `<label>Volume <input> <output>` leaves the
  // output unnamed as Chromium does; two inputs under one label are unchanged.
  const wrappingLabel =
    closest &&
    (!closest.hasAttribute("for") || closest.getAttribute("for") === id) &&
    (!/^(output|meter|progress)$/.test(control.localName) ||
      (closest as HTMLLabelElement).control === control)
      ? closest
      : null;
  if (wrappingLabel && !labels.includes(wrappingLabel)) {
    labels.push(wrappingLabel);
    labels.sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    );
  }
  return { labels, wrappingLabel };
}
