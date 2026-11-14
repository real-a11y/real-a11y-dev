/**
 * How the name walk spaces and hides what it reads. Kept out of
 * dom-extractor.ts, which is at its length ceiling.
 */
import { isAriaHiddenValue } from "./aria-tokens.js";
import {
  safeGetAttribute,
  safeParentElement,
  safeRootNode,
  safeTagName,
} from "./clobber-safe.js";
import {
  getCachedComputedStyle,
  getImplicitRole,
  isSubtreeHidden,
  type StyleCache,
} from "./role-map.js";
import { isHiddenByVisibility } from "./visibility.js";

/** The part of a name walk that says whether the current element's text shows. */
export interface TextVisibility {
  /**
   * Whether text directly inside the element being read shows: `visibility:
   * hidden` and `collapse` hide an element's own text, not its subtree (a child
   * may be visible again), accname §2A. `null` filters nothing. Unset, the root
   * decides, and a hidden root filters nothing: the carve-out reads the whole
   * subtree of a directly referenced hidden node.
   */
  readonly textVisible?: boolean | null;
}

/**
 * True if text directly inside an element with this computed `style` shows.
 * `visibility` is inherited and a child may set it back to `visible`, so it
 * hides an element's own text, not its subtree: a walk still descends.
 */
export function isTextVisible(style: CSSStyleDeclaration | null): boolean {
  return !isHiddenByVisibility(style?.visibility);
}

/**
 * Whether the walk filters at its root: as given, else only under a visible
 * root. The style is read only when the walk was not told, and a root whose style cannot be read (an
 * element inside a `<form>` that a control has clobbered) filters nothing,
 * as it did before the root's style was asked for.
 */
export function rootTextVisible(
  walk: TextVisibility & { inReference?: boolean | "hidden" },
  root: Element,
  styleCache?: StyleCache | null,
): boolean | null {
  if (walk.textVisible !== undefined) return walk.textVisible;
  // A hidden reference root reads its whole subtree, visibility included.
  if (walk.inReference === "hidden") return null;
  try {
    return isTextVisible(getCachedComputedStyle(root, styleCache)) || null;
  } catch {
    return null;
  }
}

/** The walk for a child: filtered by its own style, unless nothing is filtered. */
export function childTextWalk<W extends TextVisibility>(
  walk: W,
  childStyle: CSSStyleDeclaration | null,
): W & { textVisible: boolean | null } {
  return {
    ...walk,
    textVisible: walk.textVisible === null ? null : isTextVisible(childStyle),
  };
}

/**
 * True for a child the name walk never reads into: a named widget lends its
 * own name, an image lends its name and never its content, and a barrier lends
 * nothing. A hidden one stays opaque too.
 */
export function isOpaqueNameChild(child: Element): boolean {
  const role = getImplicitRole(child);
  return (
    role === "img" ||
    NAMED_WIDGET_ROLES.has(role) ||
    (NAME_BARRIER_ROLES.has(role) && !isImplicitDetailsGroup(child))
  );
}

/**
 * What a `visibility: hidden` child adds: its box still spaces its neighbours
 * and a descendant may be visible again, but it lends no alternative of its
 * own, and an opaque child is not read into at all.
 */
export function hiddenChildText(
  child: Element,
  spaced: boolean,
  read: () => string,
): string {
  const inner = isOpaqueNameChild(child) ? "" : read();
  return spaced ? ` ${inner} ` : inner;
}

/**
 * True when the child has a box of its own, so text beside it can't flow into it
 * and the two must not read as one word. Chromium's name computation separates
 * exactly these — whether or not the child lends any text — and this mirrors it
 * against Chromium 141:
 *
 * - **Spaced:** blocks, list items, table parts, and the atomic inline-level
 *   boxes — `inline-block`, `inline-flex`, `inline-table` — which Chromium
 *   separates even though they sit on the line. Flex and grid items, floats and
 *   absolutely positioned children need no special case: CSS blockifies their
 *   computed `display`, so a `<span>` flex item arrives here as `block`.
 * - **Not spaced:** the non-atomic inline boxes text really does flow into —
 *   `inline`, `inline list-item`, and the `ruby` family. `display: contents`
 *   generates no box at all, so its children decide their own spacing.
 *
 * Reading computed `display` rather than a tag list means an author's
 * `display: inline` on a `<div>` (or `display: block` on a `<span>`) is honoured
 * the way it renders. Two tags are named instead, because their spacing does not
 * follow `display`: `<br>`, an inline box that ends the line, and `<summary>`,
 * which Chromium separates as its disclosure's label however it is styled.
 *
 * With no computed style to read (no `window.getComputedStyle`), keep the
 * unspaced concatenation rather than guessing.
 */
export function needsSpaceAround(
  element: Element,
  style: CSSStyleDeclaration | null,
): boolean {
  // Clobber-safe: the name walk asks this of each child it enters, and a
  // `<form>` among them may have a control named `tagName`.
  const tag = safeTagName(element);
  // `<br>` is an inline box that ends the line. A `<summary>` is its
  // disclosure's label, which Chromium separates however it is styled — an
  // author's `display: inline` on one still reads "Note S Body", not
  // "Note SBody" — so neither is decided by `display`.
  if (tag === "br" || tag === "summary") return true;
  const display = style?.display;
  // No computed style to read (no `window.getComputedStyle`): keep the
  // unspaced concatenation rather than guessing.
  if (!display) return false;
  // Compared in full, not by prefix: `inline-block` and the other atomic
  // inline-level boxes must NOT match the bare `inline` case.
  return !(
    display === "inline" ||
    display === "inline list-item" ||
    display === "contents" ||
    display.startsWith("ruby")
  );
}

/**
 * Roles that act as a name-from-content "barrier" — when encountered as a
 * descendant during name computation, their subtree contributes the empty
 * string instead of being concatenated into the ancestor's name.
 *
 * Why this exists: a `<li role="treeitem">Reports<ul role="group"><li
 * role="treeitem">report-1</li>...</ul></li>` has, by ARIA name-from-
 * content, a recursive text content of "Reports report-1 report-2 ...".
 * Real assistive tech reads only "Reports" for that row — each nested
 * treeitem is a sibling row with its own announceable name, not part of
 * its parent's name. Without this filter the inspector showed the
 * polluted concatenation (surfaced on PR #80's APG Tree View example).
 *
 * The set covers:
 *   - Containers / structural groups: group, list, menu, tree, listbox,
 *     tablist, toolbar, treegrid, grid, table, rowgroup, combobox.
 *   - Row / item widgets that carry their own name: treeitem, menuitem*,
 *     option, tab, listitem, row, cell, gridcell, columnheader,
 *     rowheader.
 *   - Embedded form controls: slider, spinbutton, textbox, searchbox.
 *     (accname §2C says these contribute their *value* when embedded in a
 *     label — e.g. `<label>Delete <input value="3"> files</label>` names
 *     "Delete 3 files". Not implemented yet; skipping is the safer
 *     approximation until the value rule lands.)
 *   - Display widgets / live regions: dialog, alertdialog, tabpanel,
 *     alert, status, log, tooltip, progressbar, meter. A tooltip or
 *     dialog nested inside a widget is its own surface, not part of the
 *     host's label.
 *
 * Intentionally NOT included (walked into so their text contributes):
 *   - generic, presentation, none — transparent.
 *   - Inline formatting roles: strong, emphasis, code, mark, deletion,
 *     insertion, subscript, superscript, term, definition, paragraph,
 *     blockquote, caption, figcaption, time, separator.
 *   - img — it lends its name (alt, an SVG's title) instead of its content;
 *     see textAlternative.
 *   - heading — kept walkable so a button/tab whose label is a heading
 *     still picks up the heading's text (e.g. `<button><h3>X</h3>`).
 *   - Named widgets (link, button, checkbox, radio, switch) — handled by
 *     {@link NAMED_WIDGET_ROLES} below: they contribute their *computed
 *     accessible name*, not raw text.
 */
export const NAME_BARRIER_ROLES = new Set<string>([
  // Containers / structural groups
  "group",
  "list",
  "menu",
  "menubar",
  "tree",
  "listbox",
  "tablist",
  "toolbar",
  "treegrid",
  "grid",
  "table",
  "rowgroup",
  "combobox",
  // Row / item widgets with their own name
  "treeitem",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "tab",
  "listitem",
  "row",
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  // Embedded form controls (see §2C note in the docstring)
  "slider",
  "spinbutton",
  "textbox",
  "searchbox",
  // Display widgets / live regions
  "dialog",
  "alertdialog",
  "tabpanel",
  "alert",
  "status",
  "log",
  "tooltip",
  "progressbar",
  "meter",
]);

/**
 * Named widgets encountered as descendants during name-from-content
 * contribute their *computed accessible name* — not their raw subtree text,
 * and not the empty string.
 *
 * Per accname-1.2 §2F.iii the walk recurses with the full name algorithm,
 * so `<h3><a aria-label="API docs">config.ts</a></h3>` names the heading
 * "API docs", and `<h3><a><code>config.ts</code></a></h3>` names it
 * "config.ts" — matching what Chrome and Firefox expose. Skipping these
 * entirely (as we briefly did) left link-wrapped headings nameless.
 *
 * Deliberately narrow: item widgets like treeitem/menuitem/option stay in
 * {@link NAME_BARRIER_ROLES} — a nested tree row is a sibling with its own
 * announceable name, not part of its parent's label (PR #84).
 */
export const NAMED_WIDGET_ROLES = new Set<string>([
  "link",
  "button",
  "checkbox",
  "radio",
  "switch",
]);

/**
 * A native `<details>` carrying only its implicit `group` role. Unlike the
 * other barrier roles, Chromium walks into it for an ancestor's name, so a
 * heading like `user commented • <details><summary>edited</summary>…` keeps its
 * "edited" part. An author's explicit `role="group"` stays a barrier: Chromium
 * treats that one like any other group.
 */
export function isImplicitDetailsGroup(element: Element): boolean {
  return (
    safeTagName(element) === "details" &&
    !safeGetAttribute(element, "role")?.trim()
  );
}

/**
 * True when an aria-labelledby or aria-describedby target is itself hidden: it
 * or an ancestor is `display: none`, `hidden`, `inert`, `content-visibility:
 * hidden` or `aria-hidden`, or it is `visibility: hidden` or `collapse`. AccName 1.2 §2A reads the whole subtree of such a
 * directly referenced node, hidden descendants included (§2B: "user agents MUST
 * include all nodes in the subtree").
 */
export function isHiddenReferenceTarget(
  target: Element,
  styleCache?: StyleCache | null,
): boolean {
  try {
    // `visibility: hidden` is inherited, so only the target's own style says.
    if (!isTextVisible(getCachedComputedStyle(target, styleCache))) return true;
  } catch {
    return false;
  }
  for (let el: Element | null = target; el; el = flatParent(el)) {
    try {
      if (
        isAriaHiddenValue(safeGetAttribute(el, "aria-hidden")) ||
        isSubtreeHidden(el, getCachedComputedStyle(el, styleCache))
      ) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

/** The walk over a reference target, `"hidden"` when the target is. */
export function referenceWalk(
  target: Element,
  styleCache?: StyleCache | null,
): { inReference: true | "hidden" } {
  return {
    inReference: isHiddenReferenceTarget(target, styleCache) ? "hidden" : true,
  };
}

/** An `aria-hidden` child is skipped, except under a hidden reference root. */
export function isAriaHiddenChild(
  child: Element,
  walk: { inReference?: boolean | "hidden" },
): boolean {
  return (
    walk.inReference !== "hidden" &&
    isAriaHiddenValue(safeGetAttribute(child, "aria-hidden"))
  );
}

/** The parent element, stepping from a shadow root to its host. */
function flatParent(el: Element): Element | null {
  const parent = safeParentElement(el);
  if (parent) return parent;
  const root = safeRootNode(el);
  return "host" in root ? (root as ShadowRoot).host : null;
}
