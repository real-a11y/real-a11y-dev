/**
 * The name a label that contains its control gives it.
 *
 * HTML-AAM excludes the control's own value, so the label's child nodes are
 * read minus the control itself and any other form control. aria-hidden and
 * hidden children are skipped. How a child is read is the caller's, so this
 * stays free of the name walk it sits inside.
 */
import { isAriaHiddenValue } from "./aria-tokens.js";
import { safeGetAttribute, safeNodeType, safeTagName } from "./clobber-safe.js";
import {
  getCachedComputedStyle,
  isSubtreeHidden,
  type StyleCache,
} from "./role-map.js";

const FORM_CONTROL_TAGS = new Set(["input", "select", "textarea"]);

export interface LabelReaders {
  readChild: (child: Element) => string;
  onUnreadable: (child: Element, error: unknown) => void;
}

export function wrappingLabelText(
  label: Element,
  control: Element,
  styleCache: StyleCache | null | undefined,
  { readChild, onUnreadable }: LabelReaders,
): string {
  const parts: string[] = [];
  for (const child of label.childNodes) {
    const type = safeNodeType(child);
    if (type === Node.TEXT_NODE) {
      const text = child.textContent?.trim();
      if (text) parts.push(text);
    } else if (type === Node.ELEMENT_NODE) {
      const childEl = child as Element;
      if (childEl === control) continue;
      // An unreadable child costs its own text, not the control's name.
      try {
        if (FORM_CONTROL_TAGS.has(safeTagName(childEl))) continue;
        if (isAriaHiddenValue(safeGetAttribute(childEl, "aria-hidden")))
          continue;
        if (
          isSubtreeHidden(childEl, getCachedComputedStyle(childEl, styleCache))
        ) {
          continue;
        }
        const text = readChild(childEl).trim();
        if (text) parts.push(text);
      } catch (error) {
        onUnreadable(childEl, error);
      }
    }
  }
  return parts.join(" ");
}
