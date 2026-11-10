/** The sr-only / visually-hidden CSS idiom. Kept out of dom-extractor.ts. */
import { safeGetAttribute, safeTagName } from "./clobber-safe.js";
import { insetCollapsesBox } from "./inset-clip.js";
import { getCachedComputedStyle } from "./role-map.js";

/** Tags that are natively interactive — never treated as visually hidden */
const INTERACTIVE_TAGS = new Set([
  "input",
  "button",
  "select",
  "textarea",
  "a",
  "details",
  "summary",
]);

/**
 * Detect the sr-only / visually-hidden CSS pattern:
 * position:absolute + tiny dimensions + clip or clip-path.
 * These elements ARE intentionally accessible to AT, but not visible.
 *
 * Interactive elements (inputs, buttons, links) are EXCLUDED — they commonly use
 * opacity:0 / position:absolute behind custom-styled visuals and remain fully usable.
 */
export function isSrOnly(
  element: Element,
  style?: CSSStyleDeclaration | null,
): boolean {
  // Custom form controls hide the native input behind a visual — not sr-only
  const tag = safeTagName(element);
  if (INTERACTIVE_TAGS.has(tag)) return false;
  if (safeGetAttribute(element, "tabindex") !== null) return false;

  const computed =
    style !== undefined ? style : getCachedComputedStyle(element);
  if (!computed) return false;
  if (computed.position !== "absolute" && computed.position !== "fixed")
    return false;

  // Classic clip: rect(0,0,0,0) or rect(1px,1px,1px,1px)
  const clip = computed.clip;
  if (clip && clip !== "auto") {
    const w = parseFloat(computed.width);
    const h = parseFloat(computed.height);
    if ((w <= 1 || isNaN(w)) && (h <= 1 || isNaN(h))) return true;
  }

  // Modern: a clip-path: inset(...) whose insets meet or cross (see
  // insetCollapsesBox) — inset(50%) and inset(100%), but inset(0 100%) too.
  const clipPath = computed.clipPath;
  if (clipPath && insetCollapsesBox(clipPath)) return true;

  return false;
}
