/**
 * What the snapshot recorder (`snapshot-record.ts`) keeps of a tree: every
 * node, less what was typed into the page. A record is a file meant to be
 * shared, and no view of the panel that draws it shows a field's value, so
 * it holds none, whatever the snapshot's text printed.
 *
 * Nor does it say which choice a sensitive field holds. The tree withholds
 * that choice's states and marks each option it is made among
 * (`a11y.choiceWithheld`), and the tab order names the one stop among them
 * `[redacted]` (`getTabSequence`), since the stop of a roving-tabindex list
 * is its chosen option. A record would still say which: by that option's
 * `tabindex`, and by focus on it. So it keeps every such option alike.
 */

import {
  getOutline,
  getTabSequence,
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
 * focus on an option of a sensitive choice is on what holds the options.
 */
export function toRecordedTree(tree: ExtractionResult): {
  recorded: RecordedTree;
  shownAs<T extends string | null | undefined>(id: T): T;
} {
  const inside = insideEditors(tree);
  const above = aboveFields(tree, inside);
  const stops = editorStops(tree, inside);
  const stopOf = new Map<string, string>();
  for (const [editor, ids] of stops)
    for (const id of ids) stopOf.set(id, editor);
  const nodes: [string, SemanticNode][] = [];
  for (const [id, node] of tree.nodes) {
    const editor = stopOf.get(id);
    if (editor !== undefined) {
      nodes.push([id, nameless(node, tree.nodes.get(editor)!)]);
    } else if (!inside.has(id)) {
      nodes.push([id, kept(node, above.has(id), stops.get(id))]);
    }
  }
  const shown = (id: string): boolean =>
    stopOf.has(id) ||
    (!inside.has(id) && !tree.nodes.get(id)?.a11y.choiceWithheld);
  const shownAs = <T extends string | null | undefined>(id: T): T => {
    let at: string | null | undefined = id;
    while (at && !shown(at)) {
      at = inside.get(at) ?? tree.nodes.get(at)?.parentId;
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
 * them), and the record leaves out the stop a sensitive choice's option
 * makes. Nor can it list a heading inside an editor as printed: the record
 * drops it, or keeps it as a nameless stop with no level. A record opens on
 * its view only where the view shows what the text printed.
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
  const printed =
    view === "tab"
      ? getTabSequence(tree).map((n) => n.id)
      : getOutline(tree).map((e) => e.id);
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
 * An option a sensitive choice is made among (`a11y.choiceWithheld`) keeps
 * nothing that would single it out from the others: no `tabindex`, no focus
 * and no mark, so a record says neither which option is the tab stop nor
 * which was marked. Its name stays, beside the others', as in the tree.
 */
function kept(
  node: SemanticNode,
  aboveField: boolean,
  stops: string[] = [],
): SemanticNode {
  const { ui: _ui, ...rest } = node;
  const { value: _value, choiceWithheld, ...a11y } = node.a11y;
  const out: SemanticNode = { ...rest, a11y };
  const field = isField(node);
  if (isEditor(node)) out.childIds = stops;
  if (choiceWithheld && node.interaction) {
    out.interaction = {
      ...node.interaction,
      isFocusable: false,
      actions: node.interaction.actions.filter((a) => a !== "focus"),
    };
  }
  if (node.dom) {
    const attributes = { ...node.dom.attributes };
    for (const name of VALUE_ATTRIBUTES) delete attributes[name];
    if (choiceWithheld) delete attributes.tabindex;
    out.dom = { ...node.dom, attributes };
    if (field) out.dom.textContent = null;
    if (field || aboveField) out.dom.descendantText = "";
  }
  return out;
}
