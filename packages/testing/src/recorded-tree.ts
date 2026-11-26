/**
 * What the snapshot recorder (`snapshot-record.ts`) keeps of a tree: every
 * node, less what was typed into the page. A record is a file meant to be
 * shared, and no view of the panel that draws it shows a field's value, so
 * it holds none, whatever the snapshot's text printed.
 *
 * Nor does it say which choice a sensitive field holds. The tree withholds
 * that choice's states and marks the options it is made among
 * (`a11y.choiceWithheld`), and the tab order names a stop among them
 * `[redacted]` (`getTabSequence`), since the stop of a roving-tabindex list
 * is its chosen option. A record would still say which: by that option's
 * `tabindex`, by focus on it, and by the mark itself where the chosen option
 * is the only one marked. So it keeps every option of a choice alike.
 */

import {
  getOutline,
  getTabSequence,
  POPUP_CHOICE_ROLES,
  REDACTED_VALUE,
  type ExtractionResult,
  type SemanticNode,
} from "@real-a11y-dev/core";

import type { SnapshotView } from "./snapshot-box.js";

/** An `ExtractionResult` as JSON can hold it: the node map as entries. */
export interface RecordedTree {
  nodes: [string, SemanticNode][];
  rootId: string;
  focusedId?: string;
  source: ExtractionResult["source"];
}

/**
 * The attributes that hold what a field was given: the ones strict mode
 * withholds (`RedactInputOption` in core's `strict-mode.ts`).
 */
const VALUE_ATTRIBUTES = ["value", "aria-valuenow", "aria-valuetext"];

/** The roles an editor of a native tree, which says no actions, can have. */
const NATIVE_EDITOR_ROLES = new Set(["textbox", "searchbox", "generic"]);

/**
 * `tree` as a record keeps it, and where a focus id of it now points. What
 * an editor holds goes whole, its nodes with it, but for its tab stops (a
 * mention chip's link, in a `contenteditable="false"` island): each stays,
 * nameless, as a child of the editor, so the TAB view keeps every stop in
 * its place. A focus inside an editor is on that stop, or on the editor; a
 * focus on an option of a sensitive choice is on what the choice is made in
 * (`choiceItems`).
 */
export function toRecordedTree(tree: ExtractionResult): {
  recorded: RecordedTree;
  shownAs<T extends string | null | undefined>(id: T): T;
} {
  const inside = insideEditors(tree);
  const above = aboveFields(tree, inside);
  const stops = editorStops(tree, inside);
  const items = choiceItems(tree);
  const stopOf = new Map<string, string>();
  for (const [editor, ids] of stops)
    for (const id of ids) stopOf.set(id, editor);
  const nodes: [string, SemanticNode][] = [];
  for (const [id, node] of tree.nodes) {
    const editor = stopOf.get(id);
    if (editor !== undefined) {
      nodes.push([id, nameless(node, tree.nodes.get(editor)!)]);
    } else if (!inside.has(id)) {
      nodes.push([id, kept(node, above.has(id), stops.get(id), items.get(id))]);
    }
  }
  const shown = (id: string): boolean =>
    stopOf.has(id) || (!inside.has(id) && !items.has(id));
  const shownAs = <T extends string | null | undefined>(id: T): T => {
    let at: string | null | undefined = id;
    while (at && !shown(at)) {
      at =
        inside.get(at) ?? items.get(at)?.within ?? tree.nodes.get(at)?.parentId;
    }
    return at as T;
  };
  return {
    recorded: {
      nodes,
      rootId: tree.rootId,
      focusedId: shownAs(tree.focusedId),
      source: tree.source,
    },
    shownAs,
  };
}

/**
 * Whether `node` is a field typed into, whose nodes are what was typed: a
 * rich-text editor's lines and runs. A node the DOM producer read says
 * whether it takes typing; a native one says no actions, so its role and
 * value stand in.
 */
function isEditor(node: SemanticNode): boolean {
  if (node.interaction) return node.interaction.actions.includes("type");
  return (
    node.a11y.value !== undefined && NATIVE_EDITOR_ROLES.has(node.a11y.role)
  );
}

/** Every node inside an editor, mapped to the editor it is inside. */
function insideEditors(tree: ExtractionResult): Map<string, string> {
  const inside = new Map<string, string>();
  for (const node of tree.nodes.values()) {
    if (!isEditor(node)) continue;
    const pending = [...node.childIds];
    for (let id = pending.pop(); id !== undefined; id = pending.pop()) {
      if (inside.get(id) === node.id) continue;
      inside.set(id, node.id);
      pending.push(...(tree.nodes.get(id)?.childIds ?? []));
    }
  }
  return inside;
}

/**
 * Each outermost editor's tab stops, in document order: what of an editor a
 * record keeps (`nameless`). The stops are the ones `getTabSequence` lists,
 * so the record can't count one it wouldn't (a hidden button) or miss one
 * it would. Not an option of a sensitive choice, which no record singles
 * out. Document order, not the sequence's: a positive `tabindex` keeps its
 * place in the tree, and the TAB view sorts it as before.
 */
function editorStops(
  tree: ExtractionResult,
  inside: ReadonlyMap<string, string>,
): Map<string, string[]> {
  const stops = new Map<string, string[]>();
  if (inside.size === 0) return stops;
  const listed = new Set(getTabSequence(tree).map((n) => n.id));
  for (const node of tree.nodes.values()) {
    if (inside.has(node.id) || !isEditor(node)) continue;
    const found: string[] = [];
    const walk = (id: string) => {
      const child = tree.nodes.get(id);
      if (!child) return;
      if (listed.has(id) && !child.a11y.choiceWithheld) found.push(id);
      for (const next of child.childIds) walk(next);
    };
    for (const id of node.childIds) walk(id);
    if (found.length > 0) stops.set(node.id, found);
  }
  return stops;
}

/**
 * How a record keeps an option of a sensitive choice (`a11y.choiceWithheld`):
 * what the choice is made in (`within`), where a focus on the option shows;
 * and the node whose focusability and `tabindex` it takes (`like`): an
 * option of the same choice the tree left unmarked, or the option itself
 * where that would make it a tab stop it isn't. With none, every option of
 * the choice is marked, and each reads as no tab stop.
 */
interface ChoiceItem {
  within: string | undefined;
  like: SemanticNode | undefined;
}

/**
 * Each option of a sensitive choice, and how a record keeps it. The tree
 * marks every option in a choice container (a list box, a grid, a radio
 * group: `POPUP_CHOICE_ROLES`), but elsewhere in a sensitive field's popup
 * only the one whose own choice state it withheld: of three buttons in a
 * dialog, the pressed one. The ones it left unmarked say how that one reads,
 * unchosen: as most of them do, a tab stop or not ({@link typicalPeer}).
 *
 * Never as a stop it isn't, though. Where focus has left a roving list's
 * chosen tab, the stop is the focused one, unmarked, and the chosen one is
 * no stop; made one, it would be a stop the text didn't print.
 *
 * A choice is made in its popup: the nearest node above its option that a
 * field controls (`aria-controls`). Within that, in the nearest choice
 * container, else the nearest node that holds another node of its role,
 * else the popup itself. Not merely the nearest unmarked node above it: a
 * date grid's day button sits in a cell of its own, which would say the
 * day. Nor anything around the popup, as a data grid whose cell holds the
 * field and its popup is. With no popup found, the same search runs to the
 * root, and falls back on the option's parent.
 */
function choiceItems(tree: ExtractionResult): Map<string, ChoiceItem> {
  const items = new Map<string, ChoiceItem>();
  const marked = [...tree.nodes.values()].filter((n) => n.a11y.choiceWithheld);
  if (marked.length === 0) return items;
  const stops = new Set(getTabSequence(tree).map((n) => n.id));
  const popups = controlledIds(tree);
  const likes = new Map<string, SemanticNode | undefined>();
  for (const node of marked) {
    const within = choiceContainer(tree, node, popups);
    const key = `${within ?? ""}\n${node.a11y.role}`;
    if (!likes.has(key)) {
      likes.set(key, typicalPeer(unmarkedPeers(tree, within, node), stops));
    }
    const peer = likes.get(key);
    const promotes = peer && stops.has(peer.id) && !stops.has(node.id);
    items.set(node.id, { within, like: promotes ? node : peer });
  }
  return items;
}

/** The element ids some node's `aria-controls` names: what fields control. */
function controlledIds(tree: ExtractionResult): Set<string> {
  const ids = new Set<string>();
  for (const node of tree.nodes.values()) {
    const named = node.dom?.attributes["aria-controls"];
    for (const id of named?.split(/\s+/) ?? []) if (id) ids.add(id);
  }
  return ids;
}

/** What `node`'s choice is made in ({@link choiceItems}). */
function choiceContainer(
  tree: ExtractionResult,
  node: SemanticNode,
  popups: ReadonlySet<string>,
): string | undefined {
  const above = (id: string | null) =>
    id === null ? undefined : tree.nodes.get(id);
  // The nodes above `node`, up to its popup.
  const path: SemanticNode[] = [];
  for (let at = above(node.parentId); at; at = above(at.parentId)) {
    path.push(at);
    const id = at.dom?.attributes.id;
    if (id !== undefined && popups.has(id)) break;
  }
  const container = path.find((at) => POPUP_CHOICE_ROLES.has(at.a11y.role));
  if (container) return container.id;
  let from = node.id;
  for (const at of path) {
    const passed = from;
    const peer = at.childIds.some(
      (id) => id !== passed && holdsRole(tree, id, node.a11y.role),
    );
    if (peer) return at.id;
    from = at.id;
  }
  const top = path[path.length - 1];
  const id = top?.dom?.attributes.id;
  return top && id !== undefined && popups.has(id)
    ? top.id
    : (node.parentId ?? undefined);
}

/** Whether the node `id`, or one below it, is in `role`. */
function holdsRole(tree: ExtractionResult, id: string, role: string): boolean {
  const node = tree.nodes.get(id);
  if (!node) return false;
  return (
    node.a11y.role === role ||
    node.childIds.some((child) => holdsRole(tree, child, role))
  );
}

/**
 * The nodes below `within`, in document order, in `node`'s role and left
 * unmarked: how `node` reads, unchosen.
 */
function unmarkedPeers(
  tree: ExtractionResult,
  within: string | undefined,
  node: SemanticNode,
): SemanticNode[] {
  const peers: SemanticNode[] = [];
  const pending = within === undefined ? [] : [within];
  for (let id = pending.shift(); id !== undefined; id = pending.shift()) {
    const at = tree.nodes.get(id);
    if (!at) continue;
    if (
      at.id !== node.id &&
      at.id !== within &&
      at.a11y.role === node.a11y.role &&
      !at.a11y.choiceWithheld
    ) {
      peers.push(at);
    }
    pending.unshift(...at.childIds);
  }
  return peers;
}

/**
 * The first of `peers` that reads as most of them do: a tab stop, or not,
 * on a tie not. A roving list's one stop, or a disabled button among
 * enabled ones, is the odd one out, not how an item reads.
 */
function typicalPeer(
  peers: SemanticNode[],
  stops: ReadonlySet<string>,
): SemanticNode | undefined {
  const asStops = peers.filter((p) => stops.has(p.id));
  const rest = peers.filter((p) => !stops.has(p.id));
  return asStops.length > rest.length ? asStops[0] : (rest[0] ?? asStops[0]);
}

/**
 * A tab stop inside `editor` as a record keeps it: a child of the editor,
 * named `[redacted]`, with no description, value, state, text or attribute
 * but the ones that place it as a stop. What it is a stop for is the editor's
 * content, which no record keeps.
 */
function nameless(node: SemanticNode, editor: SemanticNode): SemanticNode {
  const { value: _value, choiceWithheld: _held, ...a11y } = node.a11y;
  const out: SemanticNode = {
    id: node.id,
    parentId: editor.id,
    childIds: [],
    depth: editor.depth + 1,
    // No states either: a task list's checkbox in an island says, checked,
    // what the editor's content is.
    a11y: {
      ...a11y,
      name: REDACTED_VALUE,
      description: "",
      states: {},
      properties: {},
    },
  };
  if (node.interaction) out.interaction = node.interaction;
  if (node.dom) {
    const attributes: Record<string, string> = {};
    for (const name of STOP_ATTRIBUTES) {
      const value = node.dom.attributes[name];
      if (value !== undefined) attributes[name] = value;
    }
    out.dom = {
      tagName: node.dom.tagName,
      attributes,
      textContent: null,
      descendantText: "",
      isHidden: node.dom.isHidden,
    };
  }
  return out;
}

/** The attributes a nameless stop keeps: what places it, none that names it. */
const STOP_ATTRIBUTES = ["tabindex", "role", "type"];

/**
 * Whether the panel's `view` of `recorded` lists what the snapshot's text
 * listed of `tree`, in the same order: the same tab stops, or the same
 * headings. The panel's headings filter lists every heading it is given,
 * where the outline leaves out those AT can't reach (a DOM-view tree keeps
 * them). Nor can the TAB view list a stop the text named `[redacted]`, an
 * option of a sensitive choice, as printed: the record keeps it as the
 * choice's other options read, by its own name or as no stop. Nor a heading
 * inside an editor: the record drops it, or keeps it as a nameless stop with
 * no level. A record opens on its view only where the view shows what the
 * text printed.
 */
export function listsAsPrinted(
  view: SnapshotView,
  tree: ExtractionResult,
  recorded: RecordedTree,
): boolean {
  const kept: ExtractionResult = {
    ...recorded,
    nodes: new Map(recorded.nodes),
  };
  const stops = view === "tab" ? getTabSequence(tree) : [];
  if (stops.some((n) => n.a11y.choiceWithheld)) return false;
  const printed =
    view === "tab" ? stops.map((n) => n.id) : getOutline(tree).map((e) => e.id);
  if (view === "headings") {
    const inside = insideEditors(tree);
    if (printed.some((id) => inside.has(id))) return false;
  }
  const listed =
    view === "tab"
      ? getTabSequence(kept).map((n) => n.id)
      : recorded.nodes
          .filter(([, n]) => n.a11y.role === "heading")
          .map(([id]) => id);
  return (
    printed.length === listed.length &&
    printed.every((id, i) => id === listed[i])
  );
}

/** Whether `node` holds what a field was given. */
function isField(node: SemanticNode): boolean {
  return node.a11y.value !== undefined || isEditor(node);
}

/**
 * The nodes above a field, whose `descendantText` takes in what was typed
 * into an editor below them. Their own `textContent` is only their own text
 * nodes', so it stays.
 */
function aboveFields(
  tree: ExtractionResult,
  inside: ReadonlyMap<string, string>,
): Set<string> {
  const above = new Set<string>();
  for (const node of tree.nodes.values()) {
    if (inside.has(node.id) || !isField(node)) continue;
    let id = node.parentId;
    while (id !== null && !above.has(id)) {
      above.add(id);
      id = tree.nodes.get(id)?.parentId ?? null;
    }
  }
  return above;
}

/**
 * `node` as a record keeps it: no value, no panel state (`ui`, which the
 * viewer sets afresh), and none of a field's text. A field loses both text
 * previews, which for an editor are what was typed, and an editor its
 * children but its tab stops (`stops`); a node above a field (`aboveField`)
 * loses only `descendantText`.
 *
 * An option a sensitive choice is made among (`a11y.choiceWithheld`, `item`)
 * loses its mark, and reads as the choice's other options do (`unsingled`).
 * Its name stays, beside the others', as in the tree.
 */
function kept(
  node: SemanticNode,
  aboveField: boolean,
  stops: string[] = [],
  item?: ChoiceItem,
): SemanticNode {
  const { ui: _ui, ...rest } = node;
  const { value: _value, choiceWithheld: _held, ...a11y } = node.a11y;
  const out: SemanticNode = { ...rest, a11y };
  const field = isField(node);
  if (isEditor(node)) out.childIds = stops;
  if (node.dom) {
    const attributes = { ...node.dom.attributes };
    for (const name of VALUE_ATTRIBUTES) delete attributes[name];
    out.dom = { ...node.dom, attributes };
    if (field) out.dom.textContent = null;
    if (field || aboveField) out.dom.descendantText = "";
  }
  return item ? unsingled(out, item) : out;
}

/**
 * `out`, an option of a sensitive choice, with nothing that would single it
 * out from the choice's other options, so a record says neither which is the
 * tab stop nor which the tree marked: the focusability and `tabindex` of an
 * option the tree left unmarked (`item.like`), or where it marked every one,
 * none.
 */
function unsingled(out: SemanticNode, item: ChoiceItem): SemanticNode {
  const { like } = item;
  if (like) {
    if (like.interaction) out.interaction = { ...like.interaction };
    else delete out.interaction;
  } else if (out.interaction) {
    out.interaction = {
      ...out.interaction,
      isFocusable: false,
      actions: out.interaction.actions.filter((a) => a !== "focus"),
    };
  }
  if (out.dom) {
    const tabindex = like?.dom?.attributes.tabindex;
    if (tabindex === undefined) delete out.dom.attributes.tabindex;
    else out.dom.attributes.tabindex = tabindex;
  }
  return out;
}
