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
 * Two stops Chromium has are not counted yet: an editing host (see
 * role-map.ts, which counts one for conflict resolution only) and a
 * `<summary>`.
 */

/** Form controls that `disabled` removes from the focus order entirely. */
const FORM_CONTROL_TAGS = new Set(["button", "input", "select", "textarea"]);

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
 * True for an element nothing can focus, whatever else it carries: a disabled
 * form control, including one in a disabled `<fieldset>` outside its first
 * `<legend>`, or an `<input type="hidden">`. A `tabindex` or
 * `contenteditable` gives neither focus back.
 *
 * `aria-disabled` is not one of these. It announces a state and leaves the
 * element focusable, which is the point of using it.
 */
export function isFocusBarred(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (!FORM_CONTROL_TAGS.has(tag)) return false;
  if (
    tag === "input" &&
    (element.getAttribute("type") || "text").toLowerCase() === "hidden"
  )
    return true;
  try {
    return element.matches(":disabled");
  } catch {
    // A selector engine without `:disabled` still has the element's own
    // attribute, which misses only the fieldset case.
    return element.hasAttribute("disabled");
  }
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

/** True when `element` can take focus, from Tab or from script. */
export function isFocusable(element: Element): boolean {
  if (isFocusBarred(element)) return false;

  // A negative tabindex is still focusable (scripted focus), just not a stop.
  if (parseTabindex(element.getAttribute("tabindex")) !== null) return true;

  const tag = element.tagName.toLowerCase();
  // Without an href, `<a>` is a fragment target or a placeholder, not a link.
  if (tag === "a") return element.hasAttribute("href");
  if (tag === "area")
    return element.hasAttribute("href") && isInUsedImageMap(element);
  if (FORM_CONTROL_TAGS.has(tag)) return true;
  // <video controls> / <audio controls> are tab stops — Chromium exposes them
  // focusable even though the actual buttons/sliders live in a closed UA
  // shadow root.
  if (tag === "audio" || tag === "video")
    return element.hasAttribute("controls");

  return false;
}
