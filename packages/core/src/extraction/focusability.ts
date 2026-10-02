/**
 * Whether an element can take focus, decided from its own markup the way
 * Chromium decides it.
 *
 * Two readers ask this: the DOM producer's `interaction.isFocusable` facet,
 * which `getTabSequence` keys on, and presentational-role conflict resolution
 * in role-map.ts. They used to answer separately, and the facet's tag-based
 * answer counted every `<a>`, every `tabindex` attribute and a control in a
 * disabled `<fieldset>`, so `real-a11y tabs` listed stops Chromium never
 * focuses.
 *
 * Only the element's own markup is read. What an ancestor does to it (`inert`,
 * `hidden`, `display: none`) is the walk's business, since the walk never emits
 * such a node. The one ancestor rule here is a disabled `<fieldset>`, which
 * `:disabled` folds in.
 *
 * Editing counts both ways (see editing.ts): an editing host is a stop with no
 * `tabindex`, and a link inside editable content is not one.
 *
 * An image map's `<area>` is the one element whose rendering the walk does not
 * read off the element itself. It follows the image using its map, so the
 * walk emits an area only while that image is rendered (see image-map.ts).
 *
 * One stop Chromium has is not listed yet: the default summary Chromium gives
 * a `<details>` that has none of its own, which lives in a UA shadow root the
 * walk has no element for.
 */

import { safeTagName } from "./clobber-safe.js";
import { isEditable, isEditingHost } from "./editing.js";
import { imageUsingMap } from "./image-map.js";

/** Form controls that `disabled` removes from the focus order entirely. */
const FORM_CONTROL_TAGS = new Set(["button", "input", "select", "textarea"]);

/** The namespace of SVG 1.1's `xlink:href`, which SVG 2 replaced with `href`. */
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** HTML's rules for parsing integers: ASCII whitespace, a sign, digits. */
const HTML_INTEGER = /^[\t\n\f\r ]*([+-]?\d+)/;

/**
 * An attribute's integer value as HTML parses it, and Chromium with it, or
 * `null` when there is none. Parsing stops at the first non-digit, so `"1abc"`
 * is 1 and `"0.5"` is 0. A value with no leading integer, such as `""` or
 * `"abc"`, is ignored as if absent.
 */
export function parseHtmlInteger(
  value: string | null | undefined,
): number | null {
  if (value == null) return null;
  const match = HTML_INTEGER.exec(value);
  return match ? Number(match[1]) : null;
}

/** A `tabindex` value, parsed by {@link parseHtmlInteger}. */
export const parseTabindex = parseHtmlInteger;

/**
 * True when HTML calls `element` actually disabled: by its own `disabled`
 * attribute, or by a disabled `<fieldset>` it sits in outside that fieldset's
 * first `<legend>`. Chromium follows the same rule for focus and for its
 * accessibility tree's `disabled` state, so both readers ask here.
 *
 * `element.disabled` is the tempting shortcut and it is wrong: the property
 * reflects the element's own attribute only, so it misses the fieldset case.
 */
export function isActuallyDisabled(element: Element): boolean {
  try {
    return element.matches(":disabled");
  } catch {
    // A selector engine without `:disabled` still has the element's own
    // attribute, which misses only the fieldset case.
    return element.hasAttribute("disabled");
  }
}

/**
 * True for an element nothing can focus, whatever else it carries: a disabled
 * form control, including one in a disabled `<fieldset>` outside its first
 * `<legend>`, or an `<input type="hidden">`. A `tabindex` or
 * `contenteditable` gives neither focus back.
 *
 * `aria-disabled` is not one of these. It announces a state and leaves the
 * element focusable, which is the point of using it.
 */
function isFocusBarred(element: Element): boolean {
  const tag = safeTagName(element);
  if (!FORM_CONTROL_TAGS.has(tag)) return false;
  if (
    tag === "input" &&
    (element.getAttribute("type") || "text").toLowerCase() === "hidden"
  )
    return true;
  return isActuallyDisabled(element);
}

/**
 * Whether a `<summary>` is its `<details>`' summary, the disclosure toggle:
 * the first `<summary>` child, even with other content before it. Any other
 * summary, including one slotted into a details it is not a child of, is
 * plain text to Chromium. A disabled `<fieldset>` does not disable one, since
 * a summary is no form control.
 *
 * A loop over the children rather than `:scope > summary`: jsdom's selector
 * engine misses that match inside a shadow root.
 */
function isDetailsSummary(summary: Element): boolean {
  // eslint-disable-next-line no-restricted-properties -- one read, and a <summary> is never a form
  const details = summary.parentElement;
  if (!details || safeTagName(details) !== "details") return false;
  for (const child of details.children)
    if (safeTagName(child) === "summary") return child === summary;
  return false;
}

/** True when `element` can take focus, from Tab or from script. */
export function isFocusable(element: Element): boolean {
  if (isFocusBarred(element)) return false;

  const tag = safeTagName(element);
  const tabindex = parseTabindex(element.getAttribute("tabindex"));
  // An area takes focus only through an image using its map, tabindex or not.
  // Chromium reads a negative tabindex on one as unfocusable, even from script,
  // and an href as a stop unless editing takes it away, as for a link below.
  // Whether the image is rendered is the walk's business: see image-map.ts.
  if (tag === "area") {
    if (!imageUsingMap(element)) return false;
    if (tabindex !== null) return tabindex >= 0;
    return element.hasAttribute("href") && !isEditable(element);
  }

  // A negative tabindex is still focusable (scripted focus), just not a stop.
  if (tabindex !== null) return true;

  // An editing host is focusable with no tabindex; an editable element nested
  // inside one is not (Chromium focuses only the host).
  if (isEditingHost(element)) return true;

  // Without an href, `<a>` is a fragment target or a placeholder, not a link.
  // An SVG `<a>` may still carry the older `xlink:href`, which Chromium honors.
  // Editing takes a link's focusability away: Chromium won't focus one inside
  // editable content, not even from script, unless it carries its own
  // tabindex (above) or sits in a `contenteditable="false"` island. Nothing
  // else loses it: a button or an input inside an editor is still a stop.
  if (tag === "a")
    return (
      (element.hasAttribute("href") ||
        element.hasAttributeNS(XLINK_NS, "href")) &&
      !isEditable(element)
    );
  if (FORM_CONTROL_TAGS.has(tag)) return true;
  if (tag === "summary") return isDetailsSummary(element);
  // <video controls> / <audio controls> are tab stops — Chromium exposes them
  // focusable even though the actual buttons/sliders live in a closed UA
  // shadow root.
  if (tag === "audio" || tag === "video")
    return element.hasAttribute("controls");

  return false;
}
