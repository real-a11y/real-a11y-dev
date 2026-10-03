/**
 * HTML element → implicit ARIA role mapping.
 * Based on WAI-ARIA in HTML (https://www.w3.org/TR/html-aria/)
 * and HTML Accessibility API Mappings (https://w3c.github.io/html-aam/).
 */

import { isAriaHiddenValue } from "./aria-tokens.js";
import {
  safeGetAttribute,
  safeHidden,
  safeQuerySelectorAll,
  safeTagName,
} from "./clobber-safe.js";
import {
  flatParent,
  flatParentElement,
  idScope,
  isRenderedInFlatTree,
  renderingParent,
} from "./flat-tree.js";
import { isFocusable, parseHtmlInteger } from "./focusability.js";
import { imageUsingMap } from "./image-map.js";

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
 * An image map's `<area>` is the exception: it is hidden exactly while the
 * image using its map is not rendered, visibility included, and nothing about
 * the area itself counts. Every area is `display: none` in Chromium's UA
 * stylesheet since 153, and Chromium focuses one all the same. See
 * image-map.ts.
 *
 * Pass a pre-resolved `style` (from {@link getCachedComputedStyle}) to avoid
 * a second `getComputedStyle` when the caller already has one.
 */
export function isSubtreeHidden(
  element: Element,
  style?: CSSStyleDeclaration | null,
): boolean {
  // `localName` rather than `tagName`: a clobbered <form> can't throw here.
  if (element.localName === "area")
    return !isImageRendered(imageUsingMap(element));

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

/**
 * Whether an image is rendered the way Chromium needs it to be before it
 * focuses the areas of the map it uses: it has a box, it is visible, and it
 * is not inert. `isRenderedInFlatTree` rules out an image no slot takes and
 * one in the body of a closed `<details>`.
 */
function isImageRendered(image: Element | null): boolean {
  if (!image || !isRenderedInFlatTree(image)) return false;
  // Slots included: a hidden slot hides the image it renders.
  for (let el: Element | null = image; el; el = renderingParent(el)) {
    // An area renders no children, and asking whether one is hidden would
    // ask about this image again.
    if (el.localName === "area" || isSubtreeHidden(el)) return false;
  }
  const visibility = getCachedComputedStyle(image)?.visibility;
  return visibility !== "hidden" && visibility !== "collapse";
}

/**
 * Whether an image map's `<area>` is hidden from AT. Chromium's tree puts an
 * area under its image, so the image being hidden or `aria-hidden` hides it,
 * and so does the area's own `inert`, though Chromium still tabs to one. Like
 * an `aria-hidden` button, such an area then leaves the a11y view, and the tab
 * sequence read from it. Its own visibility counts for nothing, like the rest
 * of its style.
 */
function isAreaHiddenFromAT(area: Element): boolean {
  if (area.hasAttribute("inert")) return true;
  const image = imageUsingMap(area);
  if (!image || !isImageRendered(image)) return true;
  for (let el: Element | null = image; el; el = renderingParent(el)) {
    // Clobber-safe: a <form> among them may hold `<input name="getAttribute">`.
    if (isAriaHiddenValue(safeGetAttribute(el, "aria-hidden"))) return true;
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
  // eslint-disable-next-line no-restricted-properties -- one read, and a <th> is never a form
  const row = el.parentElement;
  if (!row || safeTagName(row) !== "tr") return "rowheader";

  // eslint-disable-next-line no-restricted-properties -- one read, and `row` is a <tr> by the check above
  const section = row.parentElement;
  if (section && safeTagName(section) === "thead") return "columnheader";

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
    const tag = safeTagName(parent);
    if (["article", "aside", "main", "nav", "section"].includes(tag)) {
      return false;
    }
    parent = flatParent(parent);
  }
  return true;
}

/** Chromium holds a select's size as an unsigned 32-bit integer; a larger value fails to parse. */
const MAX_SELECT_SIZE = 0xffffffff;

/**
 * A `<select>`'s implicit role over its markup alone — its `size` and
 * `multiple` attributes — for callers with no live `Element`, such as the
 * testing matcher reading a node's recorded `dom.attributes`. The role map
 * reads an element through this too, so the two cannot disagree.
 *
 * A select is a list box when it shows more than one row, and a drop-down
 * combobox otherwise. HTML calls the row count its display size: `size` when
 * it parses to a positive integer, otherwise 4 for a `multiple` select and 1
 * for any other. HTML-AAM maps every `multiple` select to a list box, but
 * HTML lets one with a display size of 1 render as a drop-down, and Chromium
 * does — so `<select multiple size="1">` is a combobox in its tree, and here.
 *
 * Parsed from the attribute rather than read off the `size` property, which
 * reads 0 past 2^31 - 1 where Chromium still counts the rows.
 */
export function selectRoleFromAttributes(attributes: {
  size?: string | null;
  multiple?: string | null;
}): "listbox" | "combobox" {
  const size = parseHtmlInteger(attributes.size) ?? 0;
  const displaySize =
    size > 0 && size <= MAX_SELECT_SIZE
      ? size
      : attributes.multiple != null
        ? 4
        : 1;
  return displaySize > 1 ? "listbox" : "combobox";
}

const NATIVE_LIST_TAGS = new Set(["ul", "ol", "menu"]);

/**
 * Chromium's native `<li>` role (`ShouldIgnoreListItem`): an `<li>` whose
 * flat-tree parent is a `<ul>`/`<ol>`/`<menu>` carrying any `role` but exactly
 * `list` or `directory` is presentational — how `<ul role="none">` strips the
 * list semantics from its items as well as from itself.
 *
 * It is the element's own role, not an authored `role="none"`, so focus and
 * global ARIA attributes don't void it, and the comparison is on the raw
 * attribute: `role="LIST"` and `role=" list "` strip the items too. An
 * authored role on the `<li>` itself still wins.
 */
function listItemRole(el: Element): string {
  const parent = flatParentElement(el);
  if (parent && NATIVE_LIST_TAGS.has(safeTagName(parent))) {
    const role = safeGetAttribute(parent, "role");
    if (role && role !== "list" && role !== "directory") return "presentation";
  }
  return "listitem";
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

/**
 * The `<input>` types a `<datalist>` makes a combobox in Chromium's tree, as
 * measured in Chromium 151 and 153. HTML-AAM names the text types; Chromium
 * does the same for a number and the date and time types. A range or color
 * input uses its suggestions inside its own widget and keeps its role, and
 * `list` doesn't apply to the other types at all.
 */
const DATALIST_COMBOBOX_INPUT_TYPES: ReadonlySet<string> = new Set([
  "text",
  "search",
  "email",
  "tel",
  "url",
  "number",
  "date",
  "datetime-local",
  "month",
  "week",
  "time",
]);

/**
 * True when an `<input>` is a combobox because its `list` names a
 * `<datalist>`: typing offers the datalist's suggestions in a popup the
 * browser draws.
 *
 * Resolved through the `list` property, which is HTML's own lookup: the first
 * element with that id in the input's tree, and only if it is a `<datalist>`.
 * So a `list` naming a missing id, another element, or a datalist across a
 * shadow boundary leaves the input as it was, as in Chromium. The datalist's
 * contents don't matter: an empty or hidden one still counts.
 *
 * Exported for the testing matcher, which needs to know the popup is the
 * browser's: an author has no `aria-expanded` or `aria-controls` to write.
 */
export function isDatalistCombobox(element: Element): boolean {
  const input = element as HTMLInputElement;
  if (!DATALIST_COMBOBOX_INPUT_TYPES.has(input.type)) return false;
  try {
    return input.list != null;
  } catch {
    // jsdom throws for an input outside any document or shadow root, where
    // Chromium finds no datalist.
    return false;
  }
}

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
    if (isDatalistCombobox(el)) return "combobox";
    const type = (el as HTMLInputElement).type || "text";
    return INPUT_TYPE_ROLE_MAP[type] || "textbox";
  },
  ins: "insertion",
  kbd: "generic",
  label: "generic",
  legend: "generic",
  li: listItemRole,
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
  select: (el) =>
    selectRoleFromAttributes({
      size: el.getAttribute("size"),
      multiple: el.getAttribute("multiple"),
    }),
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
    isFocusable(element) ||
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
    isFocusable(element)
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

/**
 * Every `role` token Chromium recognises: the concrete ARIA roles (with 1.3's
 * `comment`, `suggestion`, `mark`, `sectionheader`, `sectionfooter`), the DPUB
 * and Graphics module roles, and the `image`/`directory` synonyms. Measured
 * rather than transcribed — `role="<token> button"` over CDP in Chromium 151
 * and 153 resolves to `button` exactly when the token is skipped — and checked
 * against every role in Chromium's own `aria_properties.json5`. Skipped: the
 * abstract roles (`widget`, `section`, `landmark`, …), Chromium's internal
 * names (`disclosuretriangle`, `labeltext`, `video`), and anything misspelled.
 */
const RECOGNISED_ROLES: ReadonlySet<string> = new Set([
  ...`alert alertdialog application article banner blockquote button caption
    cell checkbox code columnheader combobox comment complementary contentinfo
    definition deletion dialog directory document emphasis feed figure form
    generic grid gridcell group heading image img insertion link list listbox
    listitem log main mark marquee math menu menubar menuitem menuitemcheckbox
    menuitemradio meter navigation none note option paragraph presentation
    progressbar radio radiogroup region row rowgroup rowheader scrollbar search
    searchbox sectionfooter sectionheader separator slider spinbutton status
    strong subscript suggestion superscript switch tab table tablist tabpanel
    term textbox time timer toolbar tooltip tree treegrid treeitem`.split(
    /\s+/,
  ),
  ...`abstract acknowledgments afterword appendix backlink biblioentry
    bibliography biblioref chapter colophon conclusion cover credit credits
    dedication endnote endnotes epigraph epilogue errata example footnote
    foreword glossary glossref index introduction noteref notice pagebreak
    pagefooter pageheader pagelist part preface prologue pullquote qna subtitle
    tip toc`
    .split(/\s+/)
    .map((role) => `doc-${role}`),
  "graphics-document",
  "graphics-object",
  "graphics-symbol",
]);

/**
 * ARIA role synonyms, folded to the token the rest of the engine speaks.
 * ARIA 1.3's `image` is Chromium's same image role as `img`, and the native
 * producer already reports it as `img` (`mapNativeAXRole`). ARIA 1.2
 * deprecated `directory`, and Chromium exposes it as a `list`.
 */
const ROLE_SYNONYMS: ReadonlyMap<string, string> = new Map([
  ["image", "img"],
  ["directory", "list"],
]);

/**
 * The role one `role` token names, as Chromium reads it — ASCII
 * case-insensitively, synonyms folded — or `undefined` for a token it doesn't
 * recognise. Set lookups throughout, so `role="constructor"` can't resolve to
 * `Object.prototype`'s.
 */
export function resolveRoleToken(token: string): string | undefined {
  const lower = token.replace(/[A-Z]+/g, (upper) => upper.toLowerCase());
  return RECOGNISED_ROLES.has(lower)
    ? (ROLE_SYNONYMS.get(lower) ?? lower)
    : undefined;
}

/** The first token of a `role` value that resolves and that `accepts`. */
function roleFromAttribute(
  value: string,
  accepts?: (role: string) => boolean,
): string | undefined {
  for (const token of value.trim().split(/\s+/)) {
    const role = resolveRoleToken(token);
    if (role && (!accepts || accepts(role))) return role;
  }
  return undefined;
}

/**
 * Where Chromium requires a role to sit before it will expose it — and these
 * three are all it enforces; `menuitem`, `tab`, `row`, `cell` and the rest
 * keep their role anywhere. From `IsOrphanedListItem` / `IsOrphanedOption` /
 * `IsOrphanedTreeItem` in Blink's `ax_object.cc`, each rule measured over CDP.
 *
 * - `tags`: an element that is a context by its tag, whatever role it carries
 *   (`<ul role="navigation">` still holds list items).
 * - `roles`: a context by the first token its `role` resolves to. An implicit
 *   role doesn't count: a `<fieldset>` is a group but holds no list items.
 * - `through`: roles the climb passes over rather than stopping at.
 */
interface RequiredContext {
  tags: ReadonlySet<string>;
  roles: ReadonlySet<string>;
  through: ReadonlySet<string>;
}

const PRESENTATIONAL_TOKENS = ["none", "presentation"];

const REQUIRED_CONTEXT: ReadonlyMap<string, RequiredContext> = new Map([
  [
    "listitem",
    {
      tags: NATIVE_LIST_TAGS,
      roles: new Set(["list", "group"]),
      through: new Set(PRESENTATIONAL_TOKENS),
    },
  ],
  [
    "option",
    {
      tags: new Set(["select"]),
      roles: new Set(["listbox", "group"]),
      through: new Set(PRESENTATIONAL_TOKENS),
    },
  ],
  [
    "treeitem",
    {
      tags: new Set<string>(),
      roles: new Set(["tree", "group"]),
      // A nested tree's items sit inside their parent item.
      through: new Set([...PRESENTATIONAL_TOKENS, "treeitem"]),
    },
  ],
]);

/**
 * A wrapper the context climb passes through: a role-less `div`, `span`,
 * `slot` or custom element. Anything else — a `<section>`, an `<li>`, a
 * `role="generic"` — ends the climb, even where it extracts as generic.
 */
function isGenericWrapper(element: Element, roleAttr: string | null): boolean {
  if (roleAttr) return false;
  const tag = safeTagName(element);
  return tag === "div" || tag === "span" || tag === "slot" || tag.includes("-");
}

/** The first element whose `aria-owns` names `element`, in its id scope. */
function ariaOwner(element: Element): Element | null {
  const id = element.getAttribute("id");
  if (!id) return null;
  for (const owner of safeQuerySelectorAll(idScope(element), "[aria-owns]")) {
    const owns = safeGetAttribute(owner, "aria-owns") ?? "";
    if (owns.trim().split(/\s+/).includes(id)) {
      return owner;
    }
  }
  return null;
}

/**
 * Whether `role` has the context Chromium requires of it at `element`. The
 * climb runs over flat-tree parents; an `aria-owns` owner with a context role
 * counts too, and is looked for only when the climb fails, since orphans are
 * rare and the lookup scans the document.
 *
 * Every read here is of ANOTHER element, so every read is clobber-safe: a
 * `<form>` on the way up may hold a control named `getAttribute`.
 */
function hasRequiredContext(element: Element, role: string): boolean {
  const context = REQUIRED_CONTEXT.get(role);
  if (!context) return true;
  for (let p = flatParentElement(element); p; p = flatParentElement(p)) {
    if (context.tags.has(safeTagName(p))) return true;
    const roleAttr = safeGetAttribute(p, "role");
    const parentRole = roleAttr ? roleFromAttribute(roleAttr) : undefined;
    if (parentRole && context.roles.has(parentRole)) return true;
    if (parentRole && context.through.has(parentRole)) continue;
    if (isGenericWrapper(p, roleAttr)) continue;
    break;
  }
  const owner = ariaOwner(element);
  // The owner's role is read without its own context check: two orphans that
  // own each other would otherwise recurse forever, and no role that can
  // provide a context is one that needs one.
  return !!owner && context.roles.has(resolveRole(owner, false));
}

/**
 * The author's role, as Chromium resolves the `role` attribute: the first
 * token it recognises and whose required context is present. `undefined` when
 * no token qualifies — the element then has its own role. The one parse of the
 * attribute, so everything that reads an authored role agrees with the tree.
 */
export function getExplicitRole(element: Element): string | undefined {
  return explicitRoleOf(element, true);
}

function explicitRoleOf(
  element: Element,
  checkContext: boolean,
): string | undefined {
  // Safe: this also reads an `aria-owns` owner's role (see hasRequiredContext).
  const value = safeGetAttribute(element, "role");
  if (!value) return undefined;
  return roleFromAttribute(
    value,
    checkContext ? (role) => hasRequiredContext(element, role) : undefined,
  );
}

/** Resolve the implicit ARIA role for an element */
export function getImplicitRole(element: Element): string {
  return resolveRole(element, true);
}

function resolveRole(element: Element, checkContext: boolean): string {
  const explicitRole = explicitRoleOf(element, checkContext);
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

  const tag = safeTagName(element);
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
  const tag = safeTagName(element);
  if (HIDDEN_FROM_AT.has(tag)) return true;

  // aria-hidden hides the element AND its entire subtree from AT, for every
  // value Chromium reads as true: "TRUE" and "yes" as well as "true".
  if (isAriaHiddenValue(element.getAttribute("aria-hidden"))) return true;

  if (tag === "area") return isAreaHiddenFromAT(element);

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
  if (ariaLevel && getExplicitRole(element) === "heading") {
    return parseInt(ariaLevel, 10);
  }

  return null;
}
