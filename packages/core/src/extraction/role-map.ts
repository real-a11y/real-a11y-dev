/**
 * HTML element → implicit ARIA role mapping.
 * Based on WAI-ARIA in HTML (https://www.w3.org/TR/html-aria/)
 * and HTML Accessibility API Mappings (https://w3c.github.io/html-aam/).
 */

import { safeHidden } from "./clobber-safe.js";

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

function isLandmarkContext(el: Element): boolean {
  // header/footer only map to banner/contentinfo when not inside
  // article, aside, main, nav, or section
  let parent = el.parentElement;
  while (parent) {
    const tag = parent.tagName.toLowerCase();
    if (["article", "aside", "main", "nav", "section"].includes(tag)) {
      return false;
    }
    parent = parent.parentElement;
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
  footer: (el) => (isLandmarkContext(el) ? "contentinfo" : "generic"),
  form: "form",
  h1: "heading",
  h2: "heading",
  h3: "heading",
  h4: "heading",
  h5: "heading",
  h6: "heading",
  header: (el) => (isLandmarkContext(el) ? "banner" : "generic"),
  hgroup: "group",
  hr: "separator",
  html: "document",
  i: "generic",
  iframe: "group",
  img: (el) => (el.getAttribute("alt") === "" ? "presentation" : "img"),
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
  th: (el) =>
    el.getAttribute("scope") === "col" ? "columnheader" : "rowheader",
  thead: "rowgroup",
  time: "time",
  tr: "row",
  u: "generic",
  ul: "list",
  var: "generic",
  video: "video", // see the audio entry — mirrors Chromium's native tree
};

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
  if (explicitRole === "presentation" || explicitRole === "none")
    return "presentation";
  if (explicitRole) return explicitRole;

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
