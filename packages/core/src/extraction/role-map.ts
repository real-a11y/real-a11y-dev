/**
 * HTML element → implicit ARIA role mapping.
 * Based on WAI-ARIA in HTML (https://www.w3.org/TR/html-aria/)
 * and HTML Accessibility API Mappings (https://w3c.github.io/html-aam/).
 */

import { safeHidden } from "./clobber-safe.js";
import { flatParent } from "./flat-tree.js";

type RoleResolver = string | ((el: Element) => string);

/**
 * Per-extraction cache of `getComputedStyle` results. Created once at the
 * start of `extractDomTree` and threaded through the walk so each element
 * resolves style at most once (display / visibility / sr-only / AT-hidden
 * all share the same declaration).
 */
export type StyleCache = WeakMap<Element, CSSStyleDeclaration>;

/**
 * Resolve computed style, optionally via a per-extraction WeakMap so repeat
 * callers on the same element don't re-enter `getComputedStyle`.
 */
export function getCachedComputedStyle(
  element: Element,
  cache?: StyleCache | null,
): CSSStyleDeclaration | null {
  if (typeof window === "undefined" || !window.getComputedStyle) return null;
  if (cache) {
    const hit = cache.get(element);
    if (hit) return hit;
    const style = window.getComputedStyle(element as HTMLElement);
    cache.set(element, style);
    return style;
  }
  return window.getComputedStyle(element as HTMLElement);
}

/**
 * True when the element's entire subtree should be skipped during extraction
 * (`hidden` attr, `inert`, `display:none`, `content-visibility:hidden`).
 *
 * Does NOT check `visibility:hidden` — that property is not subtree-hiding
 * (a child can set `visibility:visible` and become visible again), so the
 * walk must still descend.
 *
 * Pass a pre-resolved `style` (from {@link getCachedComputedStyle}) to avoid
 * a second `getComputedStyle` when the caller already has one.
 */
export function isSubtreeHidden(
  element: Element,
  style?: CSSStyleDeclaration | null,
): boolean {
  // Clobber-immune read: a `<form>` with `<input name="hidden">` makes
  // `htmlEl.hidden` return that input (truthy), which would drop the whole
  // form subtree. safeHidden() reads the real state via the prototype getter.
  if (safeHidden(element)) return true;

  // The HTML `inert` attribute hides the element AND its entire subtree
  // from both AT and keyboard navigation.
  if ((element as HTMLElement).hasAttribute("inert")) return true;

  const computed =
    style !== undefined ? style : getCachedComputedStyle(element);
  if (computed) {
    if (computed.display === "none") return true;
    // content-visibility:hidden skips rendering AND hides from AT
    // (used by frameworks like Yahoo Atomizer as Cntv(h))
    if (computed.contentVisibility === "hidden") return true;
  } else if ((element as HTMLElement).style?.display === "none") {
    return true;
  }

  return false;
}

function hasAccessibleName(el: Element): boolean {
  return !!(
    el.getAttribute("aria-label") ||
    el.getAttribute("aria-labelledby") ||
    el.getAttribute("title")
  );
}

function thHeaderRole(el: Element): string {
  // An explicit scope decides on its own; colgroup/rowgroup scope the same
  // axis as col/row for role purposes.
  const scope = el.getAttribute("scope");
  if (scope === "col" || scope === "colgroup") return "columnheader";
  if (scope === "row" || scope === "rowgroup") return "rowheader";

  // No scope: HTML-AAM's auto algorithm looks at where the cell sits. A
  // header row (<thead>, or the table's first row when there is no <thead>)
  // labels columns; anything else labels its row. Ancestor walk only — no
  // layout reads.
  const row = el.parentElement;
  if (!row || row.tagName.toLowerCase() !== "tr") return "rowheader";

  if (row.parentElement?.tagName.toLowerCase() === "thead")
    return "columnheader";

  // Otherwise only the table's very first row heads columns. When a <thead>
  // exists its row wins that check, so a <th> leading a body row stays a
  // rowheader (the "Name | Ada" leading-cell pattern). A <tr> always precedes
  // its own descendants in document order, so a nested table can't win here.
  const table = row.closest("table");
  return table && row === table.querySelector("tr")
    ? "columnheader"
    : "rowheader";
}

function isLandmarkContext(el: Element): boolean {
  // header/footer only map to banner/contentinfo when not inside
  // article, aside, main, nav, or section. Ancestors are read in the flat
  // tree, so a header inside a component rendered within <main> is scoped
  // by that <main>, as the browser scopes it.
  let parent = flatParent(el);
  while (parent) {
    const tag = parent.tagName.toLowerCase();
    if (["article", "aside", "main", "nav", "section"].includes(tag)) {
      return false;
    }
    parent = flatParent(parent);
  }
  return true;
}

const INPUT_TYPE_ROLE_MAP: Record<string, string> = {
  button: "button",
  checkbox: "checkbox",
  email: "textbox",
  image: "button",
  number: "spinbutton",
  password: "textbox",
  radio: "radio",
  range: "slider",
  reset: "button",
  search: "searchbox",
  submit: "button",
  tel: "textbox",
  text: "textbox",
  url: "textbox",
};

const ROLE_MAP: Record<string, RoleResolver> = {
  a: (el) => (el.hasAttribute("href") ? "link" : "generic"),
  abbr: "generic",
  address: "group",
  area: (el) => (el.hasAttribute("href") ? "link" : "generic"),
  article: "article",
  aside: "complementary",
  // <audio>/<video>: ARIA has no media roles and HTML-AAM says "no
  // corresponding role", but real browser accessibility trees disagree
  // with that framing — Chromium exposes internal Audio/Video roles
  // (what DevTools' a11y panel shows and what CDP returns), and that is
  // the ground truth this engine mirrors. "generic" hid media elements
  // behind the same role as a <div>, so the panel couldn't distinguish
  // a named, captioned player from a decorative background loop.
  //
  // NOTE for a future core → @real-a11y-dev/validate adapter: these are
  // COMPUTED engine roles, not authored ARIA. An author writing
  // role="video" must still be flagged by isValidRole; an adapter mapping
  // SemanticNode → ValidatedNode has to exempt engine vocabulary instead
  // of loosening the ARIA schema.
  audio: "audio",
  b: "generic",
  blockquote: "blockquote",
  body: "generic",
  br: "generic",
  button: "button",
  caption: "caption",
  code: "code",
  col: "generic",
  colgroup: "generic",
  data: "generic",
  datalist: "listbox",
  dd: "definition",
  del: "deletion",
  details: "group",
  dfn: "term",
  dialog: "dialog",
  div: "generic",
  dl: "list",
  dt: "term",
  em: "emphasis",
  fieldset: "group",
  figcaption: "generic",
  figure: "figure",
  // header/footer scoped to body are landmarks; inside main or sectioning
  // content HTML-AAM maps them to the ARIA 1.3 sectionheader/sectionfooter
  // roles (what Chromium exposes too). The a11y view still flattens a bare
  // one — see SECTION_HEADER_FOOTER_ROLES in a11y-extractor.ts.
  footer: (el) => (isLandmarkContext(el) ? "contentinfo" : "sectionfooter"),
  form: "form",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  header: (el) => (isLandmarkContext(el) ? "banner" : "sectionheader"),
  hgroup: "group",
  hr: "separator",
  html: "document",
  i: "generic",
  iframe: "group",
  // HTML-AAM maps `alt=""` to presentation only when nothing else names the
  // image. `<img alt="" title="Tap to zoom">` is a named, exposed image. See
  // emptyAltIsNamed.
  img: (el) =>
    el.getAttribute("alt") === "" && !emptyAltIsNamed(el)
      ? "presentation"
      : "img",
  input: (el) => {
    const type = (el as HTMLInputElement).type || "text";
    return INPUT_TYPE_ROLE_MAP[type] || "textbox";
  },
  ins: "insertion",
  kbd: "generic",
  label: "generic",
  legend: "generic",
  li: "listitem",
  main: "main",
  mark: "mark",
  math: "math",
  menu: "list",
  meter: "meter",
  nav: "navigation",
  ol: "list",
  optgroup: "group",
  option: "option",
  output: "status",
  p: "paragraph",
  pre: "generic",
  progress: "progressbar",
  q: "generic",
  s: "deletion",
  samp: "generic",
  search: "search",
  section: (el) => (hasAccessibleName(el) ? "region" : "generic"),
  select: (el) => ((el as HTMLSelectElement).multiple ? "listbox" : "combobox"),
  slot: "generic",
  small: "generic",
  span: "generic",
  strong: "strong",
  sub: "subscript",
  summary: "generic",
  sup: "superscript",
  svg: "img",
  table: "table",
  tbody: "rowgroup",
  td: "cell",
  template: "generic",
  textarea: "textbox",
  tfoot: "rowgroup",
  th: thHeaderRole,
  thead: "rowgroup",
  time: "time",
  tr: "row",
  u: "generic",
  ul: "list",
  var: "generic",
  video: "video", // see the audio entry — mirrors Chromium's native tree
};

/** Form controls that `disabled` removes from the focus order entirely. */
const FORM_CONTROL_TAGS = new Set(["button", "input", "select", "textarea"]);

/**
 * Focusability, for the sole purpose of presentational conflict resolution.
 *
 * Deliberately STRICTER than the `interaction.isFocusable` facet the DOM
 * extractor stamps on nodes, which is tag-based and counts every `<a>` and
 * every `<input>`. That looseness is harmless for a facet nobody branches the
 * tree shape on, but here it decides whether an element stays in the tree at
 * all: counting `<a>` without `href`, a `disabled` control or
 * `<input type="hidden">` as focusable would resurrect exactly the decorative
 * markup this resolution exists to keep flattened. The two are not unified
 * because tightening the facet changes a published value on every node — its
 * own change, with its own migration note.
 */
function isFocusableForConflictResolution(element: Element): boolean {
  const tag = element.tagName.toLowerCase();

  // The exclusions come FIRST, before tabindex: a `tabindex` on a disabled
  // control or on <input type="hidden"> does not put it in the focus order,
  // so reading tabindex first would hand a decorative role back to exactly
  // the elements these two rules exist to keep flattened.
  if (FORM_CONTROL_TAGS.has(tag) && element.hasAttribute("disabled"))
    return false;
  // <input type="hidden"> renders nothing and is never a tab stop.
  if (
    tag === "input" &&
    (element.getAttribute("type") || "text").toLowerCase() === "hidden"
  )
    return false;

  const tabindex = element.getAttribute("tabindex");
  // A negative tabindex is still focusable (scripted focus); only an absent
  // or non-numeric one is not.
  if (tabindex !== null && tabindex.trim() !== "" && !isNaN(Number(tabindex)))
    return true;

  // A contenteditable host is focusable without any tabindex. `""` is the
  // valid shorthand for "true"; `"false"` opts back out.
  const editable = element.getAttribute("contenteditable");
  if (editable === "" || editable === "true") return true;

  if (tag === "a" || tag === "area") return element.hasAttribute("href");
  if (FORM_CONTROL_TAGS.has(tag)) return true;
  // <video controls> / <audio controls> are tab stops — Chromium exposes them
  // focusable even though the actual buttons/sliders live in a closed UA
  // shadow root.
  if (tag === "audio" || tag === "video")
    return element.hasAttribute("controls");

  return false;
}

/**
 * ARIA global states and properties, minus `aria-hidden`.
 *
 * `aria-hidden` is global, but it removes the element from the tree outright,
 * so letting it void `role="presentation"` would resurrect a role for an
 * element nobody can reach. `aria-dropeffect` and `aria-grabbed` are omitted:
 * ARIA 1.2 deprecates both.
 *
 * Exported because every name here also has to be OBSERVED: toggling one
 * changes an element's role, and an unobserved attribute change leaves the
 * panel showing a tree that is silently stale. The DOM observer spreads this
 * array rather than restating it, so the two cannot drift.
 */
export const GLOBAL_ARIA_ATTRIBUTES = [
  "aria-atomic",
  "aria-braillelabel",
  "aria-brailleroledescription",
  "aria-busy",
  "aria-controls",
  "aria-current",
  "aria-describedby",
  "aria-description",
  "aria-details",
  "aria-disabled",
  "aria-errormessage",
  "aria-flowto",
  "aria-haspopup",
  "aria-invalid",
  "aria-keyshortcuts",
  "aria-label",
  "aria-labelledby",
  "aria-live",
  "aria-owns",
  "aria-relevant",
  "aria-roledescription",
];

/** True when `attr` is present on `element` with a non-blank value. */
function hasMeaningfulAttribute(element: Element, attr: string): boolean {
  return !!element.getAttribute(attr)?.trim();
}

/**
 * ARIA "Presentational Roles Conflict Resolution": `role="presentation"` /
 * `role="none"` is IGNORED — and the implicit role exposed instead — when the
 * element is focusable or carries global ARIA states/properties. Hiding a
 * focusable control behind a decorative role would lose keyboard access, and
 * an element someone bothered to label is not decorative.
 *
 * A global attribute counts only when it actually says something:
 * `aria-label=""` states nothing, and honouring it would expose a nameless
 * node in place of a deliberately decorative one.
 *
 * ARIA also voids presentation for an element that is "otherwise interactive"
 * without being focusable (a `<div role="presentation" onclick>`). That is not
 * decided here — role resolution runs before the action probe that knows it —
 * and `keepNode` in a11y-extractor.ts already keeps such nodes.
 */
function voidsPresentation(element: Element): boolean {
  return (
    isFocusableForConflictResolution(element) ||
    GLOBAL_ARIA_ATTRIBUTES.some((attr) => hasMeaningfulAttribute(element, attr))
  );
}

/**
 * Whether `<img alt="">` is exposed after all.
 *
 * HTML-AAM makes an empty `alt` presentational only absent other naming, so
 * the gate is the NAMING attributes plus focusability — not the full global
 * set that voids an explicit `role="presentation"`. A non-naming global such
 * as `aria-describedby` would otherwise put a permanently nameless `img` in
 * the tree, which every "image has no accessible name" audit would then flag
 * for markup that is correctly marked decorative.
 */
function emptyAltIsNamed(element: Element): boolean {
  return (
    hasMeaningfulAttribute(element, "title") ||
    hasMeaningfulAttribute(element, "aria-label") ||
    hasMeaningfulAttribute(element, "aria-labelledby") ||
    isFocusableForConflictResolution(element)
  );
}

/** Elements that are hidden from the accessibility tree by default */
const HIDDEN_FROM_AT = new Set([
  "head",
  "link",
  "meta",
  "noscript",
  "script",
  "style",
  "template",
  "title",
]);

/** Resolve the implicit ARIA role for an element */
export function getImplicitRole(element: Element): string {
  const explicitRole = element.getAttribute("role")?.trim().split(/\s+/)[0];
  // role="presentation" and role="none" are synonyms — mark with the
  // canonical "presentation" role so the a11y extractor flattens the
  // element from the tree (children are promoted to the parent). This
  // matches what <img alt=""> already returns and what assistive tech /
  // browser a11y trees do per ARIA spec.
  //
  // ...unless conflict resolution voids it, in which case the element is
  // exposed with its IMPLICIT role — so we fall through to the map below
  // rather than returning early. Returning "presentation" here for a
  // focusable element is what made `<a href role="presentation">` read as
  // a presentation node instead of a link.
  if (explicitRole === "presentation" || explicitRole === "none") {
    if (!voidsPresentation(element)) return "presentation";
  } else if (explicitRole) {
    return explicitRole;
  }

  const tag = element.tagName.toLowerCase();
  const resolver = ROLE_MAP[tag];

  if (!resolver) return "generic";
  if (typeof resolver === "string") return resolver;
  return resolver(element);
}

/** Check if an element should be excluded from the accessibility tree */
export function isHiddenFromAT(
  element: Element,
  style?: CSSStyleDeclaration | null,
): boolean {
  const tag = element.tagName.toLowerCase();
  if (HIDDEN_FROM_AT.has(tag)) return true;

  // aria-hidden="true" hides element AND entire subtree from AT
  if (element.getAttribute("aria-hidden") === "true") return true;

  // role=presentation/none are NOT hidden — they map to the "presentation"
  // role in getImplicitRole and the a11y extractor flattens them (the
  // element drops out, children are promoted to the parent).

  // Resolve style once and share it with isSubtreeHidden (display / content-
  // visibility / hidden / inert) plus the visibility check below. Previously
  // this re-implemented the subtree checks line-for-line — a drift hazard.
  const computed =
    style !== undefined ? style : getCachedComputedStyle(element);

  if (isSubtreeHidden(element, computed)) return true;

  if (computed) {
    if (computed.visibility === "hidden") return true;
  } else if ((element as HTMLElement).style?.visibility === "hidden") {
    // No computed style (a DOM-less runtime): read the inline value, the same
    // fallback `isVisuallyHidden` uses. Without it the two disagree, and a
    // "not visible but exposed" node reads as sr-only content AT would see.
    return true;
  }

  return false;
}

/** Get the heading level for heading elements */
export function getHeadingLevel(element: Element): number | null {
  const match = element.tagName.match(/^H([1-6])$/i);
  if (match) return parseInt(match[1], 10);

  const ariaLevel = element.getAttribute("aria-level");
  if (ariaLevel && element.getAttribute("role") === "heading") {
    return parseInt(ariaLevel, 10);
  }

  return null;
}
