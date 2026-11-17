/**
 * What a diff's after tree marks. The panel's rules compare what a row
 * shows; a diff's text is core's `diffTrees`, which also lists a changed
 * description, a reordered list of children, and where focus went. So the
 * viewer adds those, and every row the text lists is marked. A changed value
 * stays in the text only: a record holds no value.
 */
import type {
  ExtractionResult,
  SemanticNode,
  TreeViewMode,
} from "@real-a11y-dev/core";
import {
  noteFieldChange,
  semanticTreeRules,
  type DialogRules,
} from "@real-a11y-dev/semantic-navigator-ui";

/** One side of a diff: its tree, and the node focused, if it said. */
export interface DiffSide {
  tree: ExtractionResult;
  focus: string | null | undefined;
}

export function snapshotDiffRules(
  view: TreeViewMode,
  before: DiffSide,
  after: DiffSide,
): DialogRules<SemanticNode> {
  const rules = semanticTreeRules(view);
  return {
    ...rules,
    compare(was, now) {
      const changes = rules.compare(was, now);
      noteFieldChange(
        changes,
        "description",
        was.a11y.description || undefined,
        now.a11y.description || undefined,
      );
      if (reordered(was.childIds, now.childIds)) {
        noteFieldChange(
          changes,
          "order",
          childrenText(before.tree, was.childIds),
          childrenText(after.tree, now.childIds),
        );
      }
      // As the text's `focus:` line: only when both sides say where focus
      // was. A bare tree on one side says nothing, which isn't a move.
      if (before.focus !== undefined && after.focus !== undefined) {
        noteFieldChange(
          changes,
          "states.focused",
          was.id === before.focus || undefined,
          now.id === after.focus || undefined,
        );
      }
      return changes;
    },
  };
}

/** Whether two lists hold the same children in another order: an added or
 *  removed child is marked on its own row. */
function reordered(was: string[], now: string[]): boolean {
  if (was.length !== now.length) return false;
  if (was.every((id, i) => id === now[i])) return false;
  const kept = new Set(was);
  return now.every((id) => kept.has(id));
}

/** A row's children as the change names them: `button "Save", link`. */
function childrenText(tree: ExtractionResult, ids: string[]): string {
  return ids
    .map((id) => {
      const child = tree.nodes.get(id);
      if (!child) return id;
      const { role, name } = child.a11y;
      return name ? `${role} "${name}"` : role;
    })
    .join(", ");
}
