import { AUTHOR_NAMED_ROLES } from "./author-named-roles.js";
import { safeTagName } from "./clobber-safe.js";
import { isEditingHost } from "./editing.js";
import { isImplicitDetailsGroup, NAME_BARRIER_ROLES } from "./name-spacing.js";
import { getExplicitRole, getImplicitRole } from "./role-map.js";

/** Tags whose text content is used as an accessible name per accname-1.2. */
const NAMES_FROM_CONTENT_TAGS = new Set<string>([
  "a",
  "button",
  "summary",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "label",
  "legend",
  "caption",
  "figcaption",
  "option",
  "td",
  "th",
]);

/**
 * Roles whose own text content is used as an accessible name — the ARIA 1.2
 * `nameFromContent` set, minus the abstract `sectionhead`.
 *
 * Being here says nothing about what an element contributes to an *ancestor's*
 * name: most of these are also in {@link NAME_BARRIER_ROLES}, which is the
 * other direction of the same relationship. A `gridcell` names itself from its
 * content and still contributes nothing to the row that contains it.
 */
const NAMES_FROM_CONTENT_ROLES = new Set<string>([
  "button",
  "link",
  "heading",
  "option",
  "treeitem",
  "tab",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "cell",
  "gridcell",
  "columnheader",
  "rowheader",
  "row",
  "checkbox",
  "radio",
  "switch",
  "tooltip",
]);

/**
 * True if `element` is a host whose accessible name can come from its
 * descendant text content. Used by the incremental extractor to decide
 * whether a text mutation must invalidate an ancestor's name. The same test
 * gates step 8 of the name computation, so the two cannot disagree.
 *
 * An authored role outranks the tag: `<button role="combobox">Apple</button>`
 * (the Radix Select trigger) is a combobox, named by its author only, and
 * Chromium leaves it unnamed — its text is the selected VALUE.
 *
 * An editing host outranks both: what is typed into an editor is its content,
 * never its label. Chromium names one only by `aria-label`,
 * `aria-labelledby` or `title` — a `<button contenteditable>` or an editable
 * `<h3>` is unnamed there, whatever it holds.
 */
export function isNameFromContentHost(element: Element): boolean {
  if (isEditingHost(element)) return false;
  const explicitRole = getExplicitRole(element);
  if (explicitRole && AUTHOR_NAMED_ROLES.has(explicitRole)) return false;
  if (NAMES_FROM_CONTENT_TAGS.has(safeTagName(element))) return true;
  return !!explicitRole && NAMES_FROM_CONTENT_ROLES.has(explicitRole);
}

/**
 * HTML-AAM owner → name-source child. These owners are not name-from-content
 * hosts, so a mutation inside the child would otherwise stop at the child
 * (often a name-barrier role) and never re-extract the owner.
 *
 * `legend`/`summary`/`caption` map to `fieldset`/`details`/`table`. A caption
 * only names the table when it is `HTMLTableElement.caption` (the first
 * caption, direct child).
 */
const NAME_SOURCE_CHILD_TO_OWNER: Readonly<Record<string, string>> = {
  legend: "fieldset",
  summary: "details",
  caption: "table",
};

/** The element whose accessible name is computed from `element`, if any. */
export function htmlAamNameOwner(element: Element): Element | null {
  const tag = safeTagName(element);
  const ownerTag = NAME_SOURCE_CHILD_TO_OWNER[tag];
  if (!ownerTag) return null;
  // eslint-disable-next-line no-restricted-properties -- one read, and a <legend>, <summary> or <caption> is never a form
  const parent = element.parentElement;
  if (!parent || safeTagName(parent) !== ownerTag) return null;
  if (tag === "caption") {
    return (parent as HTMLTableElement).caption === element ? parent : null;
  }
  return parent;
}

/**
 * True if `element` is a name-from-content barrier — its text does not bubble
 * up to name an ancestor. Its role decides, except that a native `<details>`
 * with its implicit `group` role is walked into (see
 * {@link isImplicitDetailsGroup}). The one check both the name walk and the
 * live extractor's host climb use, so they can't disagree about where a
 * name stops.
 */
export function isNameBarrierElement(element: Element): boolean {
  return (
    NAME_BARRIER_ROLES.has(getImplicitRole(element)) &&
    !isImplicitDetailsGroup(element)
  );
}
