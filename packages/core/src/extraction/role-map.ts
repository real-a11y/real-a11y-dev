/**
 * HTML element → implicit ARIA role mapping.
 * Based on WAI-ARIA in HTML (https://www.w3.org/TR/html-aria/)
 * and HTML Accessibility API Mappings (https://w3c.github.io/html-aam/).
 */

import { safeHidden } from "./clobber-safe.js";

type RoleResolver = string | ((el: Element) => string);

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
  video: "generic",
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
export function isHiddenFromAT(element: Element): boolean {
  const tag = element.tagName.toLowerCase();
  if (HIDDEN_FROM_AT.has(tag)) return true;

  // aria-hidden="true" hides element AND entire subtree from AT
  if (element.getAttribute("aria-hidden") === "true") return true;

  // role=presentation/none are NOT hidden — they map to the "presentation"
  // role in getImplicitRole and the a11y extractor flattens them (the
  // element drops out, children are promoted to the parent).

  const htmlEl = element as HTMLElement;
  // Clobber-immune read: on a `<form>` with `<input name="hidden">` the plain
  // `.hidden` property returns that input (truthy), which would wrongly hide the
  // whole form. safeHidden() reads the real state via the prototype getter.
  if (safeHidden(element)) return true;

  // The HTML `inert` attribute makes an element and its entire subtree
  // inaccessible to AT (and non-focusable). Treated the same as aria-hidden.
  if (htmlEl.hasAttribute("inert")) return true;

  // CSS display:none, visibility:hidden, and content-visibility:hidden hide from AT
  if (typeof window !== "undefined" && window.getComputedStyle) {
    const computed = window.getComputedStyle(htmlEl);
    if (computed.display === "none" || computed.visibility === "hidden") {
      return true;
    }
    if (computed.contentVisibility === "hidden") return true;
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
