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
 * Two stops Chromium has are not listed yet. One is the default summary
 * Chromium gives a `<details>` that has none of its own, which lives in a UA
 * shadow root the walk has no element for. The other is an image map's
 * `<area>`: since Chromium 153 its UA stylesheet gives one `display: none`,
 * so the walk skips it, although Chromium still tabs to it. The rule below is
 * still right wherever an area is asked about.
 */

import { safeTagName } from "./clobber-safe.js";
import { isEditable, isEditingHost } from "./editing.js";

/** Form controls that `disabled` removes from the focus order entirely. */
const FORM_CONTROL_TAGS = new Set(["button", "input", "select", "textarea"]);

/** The namespace of SVG 1.1's `xlink:href`, which SVG 2 replaced with `href`. */
const XLINK_NS = "http://www.w3.org/1999/xlink";

/** HTML's rules for parsing integers: ASCII whitespace, a sign, digits. */
const HTML_INTEGER = /^[\t\n\f\r ]*([+-]?\d+)/;

/**
 * A `tabindex` value as HTML parses it, and Chromium with it, or `null` when
 * there is none. Parsing stops at the first non-digit, so `"1abc"` is 1 and
 * `"0.5"` is 0. A value with no leading integer, such as `""` or `"abc"`, is
 * ignored as if absent.
 */
export function parseTabindex(value: string | null | undefined): number | null {
  if (value == null) return null;
  const match = HTML_INTEGER.exec(value);
  return match ? Number(match[1]) : null;
}

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
 * Whether an `<img usemap>` points at the `<map>` holding `area`. Chromium
 * focuses a map's areas only while an image uses the map, and matches
 * `usemap="#name"` against the map's `name` or `id`, case-sensitively. An
 * area is a stop at its own place in the document, not at the image's.
 */
function isInUsedImageMap(area: Element): boolean {
  const map = area.closest("map");
  if (!map) return false;
  const names = [map.getAttribute("name"), map.getAttribute("id")];
  const root = area.getRootNode() as ParentNode;
  for (const img of root.querySelectorAll("img[usemap]")) {
    const usemap = img.getAttribute("usemap") ?? "";
    if (usemap.startsWith("#") && names.includes(usemap.slice(1))) return true;
  }
  return false;
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
  const details = summary.parentElement;
  if (!details || safeTagName(details) !== "details") return false;
  for (const child of details.children)
    if (safeTagName(child) === "summary") return child === summary;
  return false;
}

/** True when `element` can take focus, from Tab or from script. */
export function isFocusable(element: Element): boolean {
  if (isFocusBarred(element)) return false;

  // A negative tabindex is still focusable (scripted focus), just not a stop.
  if (parseTabindex(element.getAttribute("tabindex")) !== null) return true;

  // An editing host is focusable with no tabindex; an editable element nested
  // inside one is not (Chromium focuses only the host).
  if (isEditingHost(element)) return true;

  const tag = safeTagName(element);
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
  if (tag === "area")
    return (
      element.hasAttribute("href") &&
      isInUsedImageMap(element) &&
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
