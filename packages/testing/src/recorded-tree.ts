/**
 * What the snapshot recorder (`snapshot-record.ts`) keeps of a tree: every
 * node, less what was typed into the page. A record is a file meant to be
 * shared, and no view of the panel that draws it shows a field's value, so
 * it holds none, whatever the snapshot's text printed.
 */

import type { ExtractionResult, SemanticNode } from "@real-a11y-dev/core";

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
 * an editor holds goes whole, its nodes with it, so a focus inside one is on
 * the editor.
 */
export function toRecordedTree(tree: ExtractionResult): {
  recorded: RecordedTree;
  shownAs<T extends string | null | undefined>(id: T): T;
} {
  const inside = insideEditors(tree);
  const above = aboveFields(tree, inside);
  const nodes: [string, SemanticNode][] = [];
  for (const [id, node] of tree.nodes) {
    if (!inside.has(id)) nodes.push([id, kept(node, above.has(id))]);
  }
  const shownAs = <T extends string | null | undefined>(id: T): T => {
    let at: string | null | undefined = id;
    while (at && inside.has(at)) at = inside.get(at);
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
 * children; a node above a field (`aboveField`) loses only
 * `descendantText`.
 */
function kept(node: SemanticNode, aboveField: boolean): SemanticNode {
  const { ui: _ui, ...rest } = node;
  const { value: _value, ...a11y } = node.a11y;
  const out: SemanticNode = { ...rest, a11y };
  const field = isField(node);
  if (isEditor(node)) out.childIds = [];
  if (node.dom) {
    const attributes = { ...node.dom.attributes };
    for (const name of VALUE_ATTRIBUTES) delete attributes[name];
    out.dom = { ...node.dom, attributes };
    if (field) out.dom.textContent = null;
    if (field || aboveField) out.dom.descendantText = "";
  }
  return out;
}
