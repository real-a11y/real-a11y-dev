/**
 * What differs between two updates of one of the shared panel's rows
 * (`TreeNode.tsx`), for the change marks (`tree-changes-diff.ts`): what the
 * row shows, in the view it shows in. An A11Y row shows its role, name and
 * heading level, its state and interaction badges, the rows it controls,
 * and a leaf's text; a DOM row shows a few of its element's attributes, its
 * own text, the same badges, and whether the element is hidden. So a class
 * that toggles on a hover marks a DOM row, and nothing in the A11Y view.
 *
 * The DOM producer names a node after its element for as long as the element
 * lasts (`getNodeId`), so every id lasts from one update to the next. Given
 * the root the panel was given, the rows of the rest of the page don't: a read
 * the extractor widened to the whole page, for a toast or a menu mounted
 * outside that root (`resolveEffectiveRoot`), brings the page around it,
 * which the page didn't add, and takes it away again when the overlay goes.
 */

import {
  getElementRefs,
  isOverlaySignal,
  type SemanticNode,
  type TreeViewMode,
} from "@real-a11y-dev/core";

import type { DialogRules } from "./tree-changes-dialogs.js";
import { noteFieldChange, type FieldChange } from "./tree-changes-diff.js";

/** The attributes a DOM row shows, in the order it shows them. */
const SHOWN_ATTRIBUTES = ["id", "class", "href", "role", "aria-label"];

/**
 * The attributes a DOM row shows, as it shows them: those of
 * {@link SHOWN_ATTRIBUTES} the element has, its first three classes only.
 */
export function shownDomAttributes(
  node: SemanticNode,
): { key: string; val: string }[] {
  const shown: { key: string; val: string }[] = [];
  for (const key of SHOWN_ATTRIBUTES) {
    const val = node.dom?.attributes[key];
    if (!val) continue;
    shown.push({
      key,
      val: key === "class" ? val.split(/\s+/).slice(0, 3).join(" ") : val,
    });
  }
  return shown;
}

type Value = string | boolean | undefined;

/** A text the row shows only when it has some: an empty one is none. */
function shownText(text: string | null | undefined): string | undefined {
  return text ? text : undefined;
}

/** A state as the row's badges show it: one that is off, or empty, shows
 *  no badge, as if absent. An `expanded` of false still reads "collapsed"
 *  in the change that names it. */
function shownState(key: string, value: Value): Value {
  if (value === "") return undefined;
  return value === false && key !== "expanded" ? undefined : value;
}

/** The ids the row's `aria-controls` names, as one comparable value: what
 *  its jump chips point at. */
function controlsOf(node: SemanticNode): string | undefined {
  const ids = (node.dom?.attributes["aria-controls"] ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return ids.length > 0 ? ids.sort().join(" ") : undefined;
}

/** The text an A11Y row previews after its name: a leaf's, where it says
 *  more than the name (`TreeNode.tsx`). */
function leafText(node: SemanticNode): string | undefined {
  const text = node.dom?.descendantText;
  return node.childIds.length === 0 && text !== node.a11y.name
    ? shownText(text)
    : undefined;
}

/** The badges both views show, a state's and what the element takes. */
function noteBadges(
  changes: FieldChange[],
  before: SemanticNode,
  after: SemanticNode,
): void {
  const was = before.a11y.states;
  const now = after.a11y.states;
  for (const key of new Set([...Object.keys(now), ...Object.keys(was)])) {
    const field = `states.${key}`;
    noteFieldChange(
      changes,
      field,
      shownState(key, was[key]),
      shownState(key, now[key]),
    );
  }
  noteFieldChange(
    changes,
    "states.interactive",
    before.interaction?.isInteractive || undefined,
    after.interaction?.isInteractive || undefined,
  );
  noteFieldChange(
    changes,
    "states.focusable",
    before.interaction?.isFocusable || undefined,
    after.interaction?.isFocusable || undefined,
  );
}

/** What differs between two updates of an A11Y row. */
function compareA11yRows(
  before: SemanticNode,
  after: SemanticNode,
): FieldChange[] {
  const changes: FieldChange[] = [];
  noteFieldChange(changes, "role", before.a11y.role, after.a11y.role);
  noteFieldChange(
    changes,
    "name",
    shownText(before.a11y.name),
    shownText(after.a11y.name),
  );
  noteFieldChange(
    changes,
    "properties.level",
    before.a11y.properties["level"],
    after.a11y.properties["level"],
  );
  noteBadges(changes, before, after);
  noteFieldChange(changes, "controls", controlsOf(before), controlsOf(after));
  noteFieldChange(changes, "text", leafText(before), leafText(after));
  return changes;
}

/** What differs between two updates of a DOM row. */
function compareDomRows(
  before: SemanticNode,
  after: SemanticNode,
): FieldChange[] {
  const changes: FieldChange[] = [];
  const was = new Map(shownDomAttributes(before).map((a) => [a.key, a.val]));
  const now = new Map(shownDomAttributes(after).map((a) => [a.key, a.val]));
  for (const key of SHOWN_ATTRIBUTES) {
    noteFieldChange(changes, `attributes.${key}`, was.get(key), now.get(key));
  }
  noteFieldChange(
    changes,
    "text",
    shownText(before.dom?.textContent),
    shownText(after.dom?.textContent),
  );
  noteBadges(changes, before, after);
  noteFieldChange(
    changes,
    "states.hidden",
    before.dom?.isHidden || undefined,
    after.dom?.isHidden || undefined,
  );
  return changes;
}

/** `Node.prototype`'s own getter for `name`, read when first asked: a
 *  page's `<form>` can shadow `parentNode` or `isConnected` with a control
 *  of that name. */
function nodeGetter<T>(name: "parentNode" | "isConnected") {
  return Object.getOwnPropertyDescriptor(Node.prototype, name)!.get as (
    this: Node,
  ) => T;
}
let parentNodeOf: ((this: Node) => Node | null) | undefined;
let isConnectedOf: ((this: Node) => boolean) | undefined;

/** `node`'s parent, out of a shadow tree to its host. */
function composedParent(node: Node): Node | null {
  parentNodeOf ??= nodeGetter<Node | null>("parentNode");
  const parent = parentNodeOf.call(node);
  if (parent) return parent;
  return node instanceof ShadowRoot ? node.host : null;
}

/**
 * Whether row `id` is one of the page `root` holds: an element inside it,
 * shadow trees included, or inside an overlay outside it (the DOM producer's
 * own `isOverlaySignal`). The root's own row, which a read widened to the
 * whole page flattens away, isn't, nor is the rest of the page such a read
 * brings. An element no longer on the page answers as it did while it was,
 * from `seen`; one never seen there can't tell, and is one.
 */
function onPanelPage(
  root: Element,
  id: string,
  seen: WeakMap<Element, boolean>,
): boolean {
  const el = getElementRefs().get(id);
  if (!el) return true;
  isConnectedOf ??= nodeGetter<boolean>("isConnected");
  if (!isConnectedOf.call(el)) return seen.get(el) ?? true;
  const on = scopeOf(root, el);
  seen.set(el, on);
  return on;
}

/** Whether `el`, on the page, is one of the page `root` holds. The rows
 *  inside the root, nearly all of them, settle on the way up to it. */
function scopeOf(root: Element, el: Element): boolean {
  if (el === root) return false;
  for (let n: Node | null = el; n; n = composedParent(n)) {
    if (n === root) return true;
  }
  let overlay: Element | null = null;
  for (let n: Node | null = el; n && !overlay; n = composedParent(n)) {
    if (n instanceof Element && isOverlaySignal(n)) overlay = n;
  }
  if (!overlay) return false;
  // A live region around the whole app, as a router's announcer can be, is
  // no overlay of its own.
  for (let n: Node | null = root; n; n = composedParent(n)) {
    if (n === overlay) return false;
  }
  return true;
}

const shared = {
  lasting: () => true,
  label: (node: SemanticNode) => ({
    role: node.a11y.role,
    name: node.a11y.name,
  }),
  role: (node: SemanticNode) => node.a11y.role,
};

const A11Y_ROWS: DialogRules<SemanticNode> = {
  ...shared,
  compare: compareA11yRows,
};

const DOM_ROWS: DialogRules<SemanticNode> = {
  ...shared,
  compare: compareDomRows,
};

/** The rules for the rows `view` shows, of the page `root` holds when the
 *  panel was given one: its own row compared, but never new or gone. The
 *  TAB view's tree is the A11Y view's, read the same way. */
export function semanticTreeRules(
  view: TreeViewMode,
  root?: Element,
): DialogRules<SemanticNode> {
  const rules = view === "dom" ? DOM_ROWS : A11Y_ROWS;
  if (!root) return rules;
  const seen = new WeakMap<Element, boolean>();
  const lasting = (id: string) => onPanelPage(root, id, seen);
  return {
    ...rules,
    lasting,
    compared: (id) => getElementRefs().get(id) === root || lasting(id),
  };
}
