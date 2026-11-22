/**
 * Where a node's choice state says what a sensitive field holds, in the DOM
 * producer. The native producers apply the same rule to Chromium's tree
 * through core's `sensitiveChoiceReach` (states) and `sensitivePopupRoots`
 * (names), which follow the same relations from the same hosts.
 */
import {
  ariaOwner,
  choiceCache,
  withAriaOwnerIndex,
  type ChoiceCache,
  type RelationReach,
} from "./aria-owner.js";
import { ariaCurrent, ariaTristate } from "./aria-tokens.js";
import {
  safeGetAttribute,
  safeGetElementById,
  safeDocumentElement,
  safeMatches,
  safeNodeType,
  safeQuerySelectorAll,
  safeRootNode,
} from "./clobber-safe.js";
import { nativeChecked } from "./element-state.js";
import {
  deepQuerySelectorAll,
  flatChildNodes,
  flatChildren,
  flatParentElement,
  idScope,
} from "./flat-tree.js";
import { getExplicitRole, getImplicitRole } from "./role-map.js";
import {
  CHOICE_ITEM_ROLES,
  FIELD_SELECTOR,
  isSensitiveField,
  POPUP_CHOICE_ROLES,
} from "./sensitivity.js";

/**
 * The first element at or above `element` that `found` accepts, in the tree
 * roles are computed in: flat-tree parents, and the `aria-owns` owner of each
 * element met on the way, as strict mode's `inChoiceField` climbs. Chromium
 * parents an owned element on its owner; both paths are read, so a page that
 * moves a node with `aria-owns` withholds at least what either place would.
 */
function searchAbove(
  element: Element,
  found: (el: Element) => boolean,
): Element | null {
  const seen = new Set<Element>([element]);
  const pending: Element[] = [element];
  for (let start = pending.pop(); start; start = pending.pop()) {
    for (let el: Element | null = start; el; el = flatParentElement(el)) {
      if (found(el)) return el;
      const owner = ariaOwner(el);
      if (owner && !seen.has(owner)) {
        seen.add(owner);
        pending.push(owner);
      }
    }
  }
  return null;
}

/** A root a deep query reads from: a document, a shadow root, a subtree's top. */
type PageScope = Document | DocumentFragment | Element;

/**
 * The roots a deep query must read from to see the whole of `element`'s page:
 * its document, and each closed shadow root on the way up, which no query
 * from above enters (a read can start inside one when the caller holds an
 * element there). A subtree in no document reads from its top.
 */
function pageScopes(element: Element): PageScope[] {
  const scopes: PageScope[] = [];
  let root = safeRootNode(element);
  while (root.nodeType === 11 /* DOCUMENT_FRAGMENT_NODE */) {
    const shadow = root as ShadowRoot;
    if (!shadow.host || shadow.mode === "closed") scopes.push(shadow);
    if (!shadow.host) return scopes;
    root = safeRootNode(shadow.host);
  }
  scopes.push(root as Document | Element);
  return scopes;
}

/** What `selector` matches at or under `scope`, open shadow roots included. */
function deepQuery(scope: PageScope, selector: string): Element[] {
  const tops =
    scope.nodeType === 9 /* DOCUMENT_NODE */
      ? [safeDocumentElement(scope as Document)].filter((el) => el !== null)
      : scope.nodeType === 11
        ? Array.from((scope as DocumentFragment).children)
        : [scope as Element];
  return tops.flatMap((top) => [
    ...(safeMatches(top, selector) ? [top] : []),
    ...deepQuerySelectorAll(top, selector),
  ]);
}

/**
 * Read each page scope of `element` ({@link pageScopes}) the extraction has
 * not seen yet: whether it holds a sensitive field, and if so the relations
 * of its hosts, into the extraction's cache.
 */
function seePage(cache: ChoiceCache, element: Element): void {
  const root = cache.readRoot;
  if (root) {
    cache.readRoot = null;
    seePage(cache, root);
  }
  for (const scope of pageScopes(element)) {
    if (cache.scopesSeen.has(scope)) continue;
    cache.scopesSeen.add(scope);
    cache.unindexed.push(scope);
    const host = (scope as ShadowRoot).host;
    if (scope.nodeType === 11 && host) {
      cache.closedRoots.set(host, scope as ShadowRoot);
    }
    if (deepQuery(scope, FIELD_SELECTOR).some(isSensitiveField)) {
      cache.sensitiveSeen = true;
    }
  }
  // Every scope's relations once any holds a sensitive field: a combobox in
  // one can wrap a field another slots into it.
  if (!cache.sensitiveSeen) return;
  for (const scope of cache.unindexed.splice(0)) {
    indexSensitiveRelations(
      deepQuery(scope as PageScope, RELATIONS),
      cache.reach,
    );
  }
}

/**
 * Run `read`, an extraction of `root`, with one set of per-extraction indexes
 * (`withAriaOwnerIndex`), `root`'s page scopes seen before any other's the
 * first time something asks ({@link seePage}), and not before: a read that
 * asks nothing (a live refresh of one field) scans no page. A read that
 * starts inside a closed shadow root then knows that root before anything in
 * it asks: a node slotted in from the document has only the document for its
 * own page.
 *
 * @internal
 */
export function withReadIndexes<T>(root: Element, read: () => T): T {
  return withAriaOwnerIndex(() => {
    const cache = choiceCache();
    if (cache) cache.readRoot = root;
    return read();
  });
}

/**
 * False only when no page scope the extraction has seen, `element`'s among
 * them, holds a sensitive field, so no choice in it can be one's. Read once
 * per scope per extraction ({@link seePage}), it spares every node with a
 * choice state, and every reference target, the climbs below on the pages
 * most often read. Any scope seen counts, not only `element`'s: a read that
 * starts inside a closed shadow root meets that root's host, outside it, on
 * the way up, and the host's own page can't see in. Outside an extraction it
 * answers true and the climbs decide.
 */
export function pageMayHoldSensitiveField(element: Element): boolean {
  const cache = choiceCache();
  if (!cache) return true;
  seePage(cache, element);
  return cache.sensitiveSeen;
}

/**
 * `element`'s children in the flat tree, through the closed shadow root it
 * hosts when this read started inside that root ({@link seePage}), which its
 * `shadowRoot` hides.
 */
function childrenOf(element: Element): Element[] {
  const closed = choiceCache()?.closedRoots.get(element);
  // The root's children with each slot replaced by what it renders, as the
  // flat tree reads an open root: an assigned node, else the fallback.
  return closed
    ? flatChildNodes(closed).filter(
        (n): n is Element => safeNodeType(n) === 1 /* ELEMENT_NODE */,
      )
    : flatChildren(element);
}

/**
 * `element` holds a sensitive field in the flat tree, as Chromium reads it: a
 * field in its shadow root, or one slotted into it from outside, counts; a
 * light child of a shadow host that no slot renders does not.
 */
export function holdsSensitiveField(element: Element): boolean {
  const pending = childrenOf(element);
  for (let el = pending.pop(); el; el = pending.pop()) {
    if (isSensitiveField(el)) return true;
    pending.push(...childrenOf(el));
  }
  return false;
}

/**
 * True for an element whose popup holds a sensitive field's choice: the field
 * itself ({@link isSensitiveField}), or a combobox around one, the ARIA 1.1
 * pattern. Such a wrapper carries `aria-controls` or `aria-owns` for the
 * field inside it, or holds its listbox as a child; either way the choice
 * made there is the field's value. The field may sit in the wrapper's shadow
 * root or be slotted into it ({@link holdsSensitiveField}), and the role is
 * read as the tree reads it, so `role="x-combo combobox"` is a combobox. The
 * native producers' counterpart is core's `sensitiveChoiceHosts`. Cached per
 * extraction: every node with a choice state below a wrapper asks about it.
 */
export function isSensitiveChoiceHost(element: Element): boolean {
  if (isSensitiveField(element)) return true;
  if (getExplicitRole(element) !== "combobox") return false;
  const hosts = choiceCache()?.hosts;
  const known = hosts?.get(element);
  if (known !== undefined) return known;
  const host = holdsSensitiveField(element);
  hosts?.set(element, host);
  return host;
}

/**
 * The choice containers (`POPUP_CHOICE_ROLES`) `active` sits in that make up
 * `host`'s popup, on every path {@link searchAbove} climbs. Not only the
 * nearest: a radio group or menu nested in a grid would otherwise bound the
 * popup, and the grid's chosen row outside it would show. But none around
 * `host` itself, since a popup doesn't hold its own field: a data grid a
 * sensitive editor sits in, with the editor's list box in a cell, keeps its
 * own rows' choice. One is still taken when it is the only container: a
 * field inside its own list box.
 */
function choiceContainersOf(active: Element, host: Element): Set<Element> {
  const found = new Set<Element>();
  let around: Element | undefined;
  searchAbove(active, (el) => {
    if (!POPUP_CHOICE_ROLES.has(getImplicitRole(el))) return false;
    if (isWithin(host, el)) around ??= el;
    else found.add(el);
    return false;
  });
  if (found.size === 0 && around) found.add(around);
  return found;
}

/** Where a field reaches a popup by relation that needs an index. */
const RELATIONS = "[aria-controls], [aria-activedescendant]";

/**
 * Add to `reach` what each of `candidates` that is a sensitive field, or a
 * combobox around one, reaches by relation, each id read in its own tree
 * scope: the ids it names in `aria-controls`, and every choice container its
 * `aria-activedescendant` sits in. The active option is always in the field's
 * popup, so a popup reached only that way is still its own. (`aria-owns`
 * needs no index: the owner climb in {@link searchAbove} meets it.)
 */
function indexSensitiveRelations(
  candidates: Iterable<Element>,
  reach: RelationReach,
): void {
  for (const host of candidates) {
    if (!isSensitiveChoiceHost(host)) continue;
    const scope = idScope(host);
    const controls = safeGetAttribute(host, "aria-controls") ?? "";
    for (const id of controls.trim().split(/\s+/)) {
      if (!id) continue;
      const ids = reach.ids.get(scope) ?? new Set<string>();
      reach.ids.set(scope, ids.add(id));
    }
    const activeId = (
      safeGetAttribute(host, "aria-activedescendant") ?? ""
    ).trim();
    const searched = idSearchRoot(host);
    for (const active of activeId ? elementsWithId(searched, activeId) : []) {
      const containers = choiceContainersOf(active, host);
      for (const reached of containers.size > 0 ? containers : [active]) {
        reach.elements.add(reached);
      }
    }
  }
}

/**
 * Every element in `scope` whose id is `id`, not only the first the page
 * resolves: a page that renders a form twice, a hidden copy first, would
 * otherwise leave the visible copy's popup out.
 */
function elementsWithId(
  scope: Document | ShadowRoot | Element,
  id: string,
): Element[] {
  const top = scope.nodeType === 1 ? [scope as Element] : [];
  return [...top, ...safeQuerySelectorAll(scope, "[id]")].filter(
    (el) => safeGetAttribute(el, "id") === id,
  );
}

/**
 * Where `host`'s IDREFs are searched for every element carrying one: its id
 * scope, or for a subtree in no document its top, which the owner document
 * its ids resolve against does not hold.
 */
function idSearchRoot(host: Element): Document | ShadowRoot | Element {
  const root = safeRootNode(host);
  return root.nodeType === 1 ? (root as Element) : idScope(host);
}

/** `reach` takes in `element`: by its id in its scope, or as itself. */
function reaches(reach: RelationReach, element: Element): boolean {
  if (reach.elements.has(element)) return true;
  const id = safeGetAttribute(element, "id");
  return id !== null && reach.ids.get(idScope(element))?.has(id) === true;
}

/**
 * True when a sensitive field, or a combobox around one, reaches `element` by
 * relation ({@link indexSensitiveRelations}): an ARIA combobox's popup
 * listbox, which is not the field's descendant, but whose selected option is
 * the field's value. Every element carrying a named id counts, not only the
 * first the page resolves: a page that renders a form twice, a hidden copy
 * first, would otherwise show the visible popup's choice. Indexed once per
 * page scope per extraction, every open shadow root with it, and answered
 * from every scope seen ({@link seePage}): the container an
 * `aria-activedescendant` reaches can sit in another tree scope than its
 * field (a listbox host around the closed shadow root that holds its own
 * input and options). Outside an extraction, `element`'s own scope is read.
 */
export function controlledBySensitiveField(element: Element): boolean {
  const cache = choiceCache();
  if (!cache) {
    const reach: RelationReach = { elements: new Set(), ids: new Map() };
    const scope = idScope(element);
    indexSensitiveRelations(safeQuerySelectorAll(scope, RELATIONS), reach);
    return reaches(reach, element);
  }
  seePage(cache, element);
  return reaches(cache.reach, element);
}

/**
 * True when `element` sits inside a sensitive field (`isSensitiveField`),
 * or inside what one controls (`aria-controls`), owns (`aria-owns`) or points
 * its `aria-activedescendant` into — or what an ARIA 1.1 combobox around one
 * does, the wrapper that carries those relations for the field inside it
 * ({@link isSensitiveChoiceHost}) — or is such a target itself. Its
 * `selected` state then says which choice the field holds, which is the value
 * the field's `[redacted]` withholds: an option of a payment `<select>`, and
 * one in the popup listbox an `<input role="combobox" autocomplete="cc-exp">`
 * controls, which is not the field's descendant.
 *
 * The climb reads the tree roles are computed in ({@link searchAbove}). Not
 * only an option: Chromium carries `selected` on tabs, rows and grid cells
 * too, and the native producers withhold it on every node in such a region,
 * so this does as well.
 */
export function inSensitiveChoice(element: Element): boolean {
  if (!pageMayHoldSensitiveField(element)) return false;
  return (
    searchAbove(
      element,
      (el) =>
        controlledBySensitiveField(el) ||
        (el !== element && isSensitiveChoiceHost(el)),
    ) !== null
  );
}

/**
 * True when `element`, in `role`, is one of the items a sensitive field's
 * choice is made among ({@link inSensitiveChoice}): a choice item
 * (`CHOICE_ITEM_ROLES`), or anything inside a choice container
 * (`POPUP_CHOICE_ROLES`) the field's popup holds, as a date grid's day button
 * is. Picking it makes the choice, so singling it out says which choice is
 * made: the one tab stop of a roving-tabindex list box is its chosen option.
 * Not the popup's other controls (a dialog's Cancel button) and not the
 * container itself, whose names don't depend on the choice.
 */
export function isSensitiveChoiceItem(element: Element, role: string): boolean {
  if (!inSensitiveChoice(element)) return false;
  if (CHOICE_ITEM_ROLES.has(role)) return true;
  return (
    searchAbove(
      element,
      (el) =>
        el !== element &&
        POPUP_CHOICE_ROLES.has(getImplicitRole(el)) &&
        inSensitiveChoice(el),
    ) !== null
  );
}

/**
 * True when what `element`, in `role`, lends a name or description it is
 * embedded in (AccName 2C) gives a sensitive field's value or choice away: a
 * sensitive field, or a combobox around one ({@link isSensitiveChoiceHost});
 * or a listbox that holds one's choice ({@link inSensitiveChoice}). `<label>
 * Expiry month <input autocomplete="cc-exp-month" aria-controls="lb"> <ul
 * id="lb">…</ul></label>` would otherwise name the field "Expiry month 03".
 * Only a choice container (`POPUP_CHOICE_ROLES`), as in the native
 * producers: an ordinary field in a panel a sensitive field controls still
 * lends its own value.
 */
export function lendsSensitiveChoice(element: Element, role: string): boolean {
  if (isSensitiveField(element)) return true;
  if (!pageMayHoldSensitiveField(element)) return false;
  return (
    isSensitiveChoiceHost(element) ||
    (POPUP_CHOICE_ROLES.has(role) && inSensitiveChoice(element))
  );
}

/**
 * `el` is chosen, by a choice state the tree withholds (`isChoiceState`):
 * `aria-selected="true"`, or without it a selected option; a choice item
 * checked (`aria-checked`, or a radio's own checkedness); pressed; or marked
 * current. The attributes are read first, so an element with none of them
 * costs no role.
 */
export function isChosen(el: Element): boolean {
  const selected = safeGetAttribute(el, "aria-selected");
  if (
    selected !== null
      ? selected.trim().toLowerCase() === "true"
      : (el as HTMLOptionElement).selected === true
  ) {
    return true;
  }
  if (marksChoice(ariaTristate(safeGetAttribute(el, "aria-pressed")))) {
    return true;
  }
  const current = ariaCurrent(safeGetAttribute(el, "aria-current"));
  if (current !== null && current !== false) return true;
  const ownChecked = nativeChecked(el);
  const checked = safeGetAttribute(el, "aria-checked");
  if (ownChecked === null && checked === null) return false;
  const role = getImplicitRole(el);
  return (
    CHOICE_ITEM_ROLES.has(role) &&
    marksChoice(ownChecked ?? ariaTristate(checked, role))
  );
}

/** A tristate read marks a choice: set, or `mixed`. */
function marksChoice(value: boolean | "mixed" | null): boolean {
  return value === true || value === "mixed";
}

/** What `element` names in `aria-owns`, in its id scope. */
function ownedBy(element: Element): Element[] {
  const scope = idScope(element);
  const owns = (safeGetAttribute(element, "aria-owns") ?? "").trim();
  return owns
    .split(/\s+/)
    .map((id) => (id ? safeGetElementById(scope, id) : null))
    .filter((el): el is Element => el !== null);
}

/**
 * Some node in `container` is chosen ({@link isChosen}), in the tree Chromium
 * reads: the flat tree, with what the container, or anything in it, owns
 * (`aria-owns`), so an option slotted into it or owned by it counts.
 */
function holdsChoice(container: Element): boolean {
  const seen = new Set<Element>([container]);
  const pending = [...childrenOf(container), ...ownedBy(container)];
  for (let el = pending.pop(); el; el = pending.pop()) {
    if (seen.has(el)) continue;
    seen.add(el);
    if (isChosen(el)) return true;
    // What a group in the popup owns is the popup's too, at any depth.
    pending.push(...childrenOf(el), ...ownedBy(el));
  }
  return false;
}

/** `element` is a sensitive field's popup with a choice made in it. */
function isSensitivePopup(element: Element): boolean {
  const role = getImplicitRole(element);
  return (
    POPUP_CHOICE_ROLES.has(role) &&
    lendsSensitiveChoice(element, role) &&
    holdsChoice(element)
  );
}

/**
 * The nearest sensitive field's popup with a choice made in it at or above
 * `element` ({@link searchAbove}): an owned option counts in the popup that
 * owns it, and an ordinary choice container on the way (a listbox nested in a
 * sensitive grid) is climbed past, as the native producers' regions read it.
 */
function sensitivePopupAt(element: Element): Element | null {
  if (!pageMayHoldSensitiveField(element)) return null;
  return searchAbove(element, isSensitivePopup);
}

/**
 * `description`, or none when `element` is, or sits in, a sensitive field's
 * popup with a choice made in it: whatever it is built from, one only the
 * chosen option carries (a hidden "selected" span, wherever it is, an
 * `aria-description`, a `title`) says which it is. Asked only of a
 * description there is, so a node without one costs no climb. The native
 * producers' counterpart is core's `withholdPopupChoiceNames`.
 */
export function withholdPopupDescription(
  element: Element,
  description: string,
): string {
  return description && sensitivePopupAt(element) ? "" : description;
}

/**
 * `element` sits inside a sensitive field in the flat tree: a `<select>`'s
 * option, whose text is the field's value. Containment only, not `aria-owns`:
 * Chromium leaves what an `<input>` owns where it is, so a listbox it owns is
 * its popup ({@link sensitivePopupAt}), not its value.
 */
function insideSensitiveField(element: Element): boolean {
  for (let el = flatParentElement(element); el; el = flatParentElement(el)) {
    if (isSensitiveField(el)) return true;
  }
  return false;
}

/** `node` is `ancestor` or sits below it in the flat tree. */
function isWithin(node: Element, ancestor: Element): boolean {
  for (let el: Element | null = node; el; el = flatParentElement(el)) {
    if (el === ancestor) return true;
  }
  return false;
}

/**
 * True when `referrer`'s reference to `target` (`aria-labelledby` or
 * `aria-describedby`) reads what a sensitive field holds: the target sits in
 * one (a drop-down `<select>`'s option, whose text is the value), or is, or
 * sits in, a sensitive field's popup with a choice made in it
 * ({@link sensitivePopupAt}). Its name then reads `[redacted]`, its
 * description is dropped. A reference from outside counts even to one
 * option: the page may point it at the chosen one (a combobox labelled by its
 * selected option). One is exempt: a node inside the popup, not the popup
 * itself, NAMED from a plain part of itself, as an option labelled by its own
 * span is, reads its own text. A description never is ({@link
 * withholdPopupDescription}). A second sensitive popup inside the exempt part still
 * withholds its own choice as the part is read: it lends it as an embedded
 * control ({@link lendsSensitiveChoice}). The native producers' counterpart
 * is core's `popupChoiceRegions`, beside the field regions.
 */
export function readsSensitivePopup(
  referrer: Element,
  target: Element,
  property: "labelledby" | "describedby",
): boolean {
  if (!pageMayHoldSensitiveField(target)) return false;
  if (insideSensitiveField(target)) return true;
  const popup = sensitivePopupAt(target);
  if (!popup) return false;
  const ownPart =
    property === "labelledby" &&
    referrer !== popup &&
    target !== popup &&
    isWithin(target, referrer) &&
    sensitivePopupAt(referrer) === popup;
  return !ownPart;
}
