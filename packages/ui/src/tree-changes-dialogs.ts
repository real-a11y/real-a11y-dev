/**
 * Which tree a read is compared with while a dialog stands in front of the
 * page (`tree-changes-diff.ts` does the comparing).
 *
 * A modal dialog takes the rest of the page out of an accessibility tree
 * while it is open, as it does for a screen reader: a native `<dialog>`
 * opened with `showModal()`, or one whose page a library hides with
 * `aria-hidden` or `inert` (Radix, and so shadcn/ui). That isn't the page
 * removing anything. So a read that brings a dialog while at least half the
 * tree it is compared with leaves, the dialog all but alone in it
 * (`standsInFront`), marks what is new and nothing removed, and keeps that
 * tree; the read the dialog is gone from compares with it, so what shows is
 * what the dialog changed on the page. A dialog opened over another keeps the
 * outer one's tree the same way, so closing it compares with the outer
 * dialog. Whether the tree marks a dialog `modal` doesn't decide it: a
 * library's modal isn't marked, and an `aria-modal` dialog that leaves the
 * page in the tree, or a modal inside a frame, is.
 */

import {
  diffTreeRows,
  isEmptyTreeChanges,
  type DiffRules,
  type Tree,
  type TreeChanges,
  type TreeRow,
} from "./tree-changes-diff.js";

/** What a tree's rows are, for comparing two reads around a dialog. */
export interface DialogRules<N extends TreeRow> extends DiffRules<N> {
  /** The node's role: a `dialog` or an `alertdialog` can stand in front of
   *  the page. */
  role(node: N): string;
}

/** A dialog in front of the rest of the tree, and the tree from before it. */
export interface OpenDialog<N extends TreeRow> {
  dialogId: string;
  before: Tree<N>;
}

/** What a read was compared with, what it found, and the dialogs it leaves
 *  open in front of the page. */
export interface DialogComparison<N extends TreeRow> {
  /** The tree the read was compared with: the run's, or the tree from
   *  before a dialog that closed came. What a follow-up read of the run
   *  compares with. */
  baseline: Tree<N>;
  /** What changed, or null for nothing. */
  changes: TreeChanges | null;
  /** The dialogs open in front of the page, outermost first. */
  dialogs: readonly OpenDialog<N>[];
}

/** The dialogs a tree shows. */
function dialogsIn<N extends TreeRow>(
  tree: Tree<N>,
  rules: DialogRules<N>,
): string[] {
  const ids: string[] = [];
  for (const [id, node] of tree.nodes) {
    const role = rules.role(node);
    if (role === "dialog" || role === "alertdialog") ids.push(id);
  }
  return ids;
}

/** How many rows `tree` shows beside dialog `dialogId`, outside its
 *  subtree: none for a `showModal()` dialog, a live region or two for one
 *  a library left the page's rest hidden beside. A synthetic root, and any
 *  other row that doesn't last, is no row of the page's. */
function rowsBeside<N extends TreeRow>(
  tree: Tree<N>,
  dialogId: string,
  rules: DialogRules<N>,
): number {
  const inside = new Set<string>();
  const stack = [dialogId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (inside.has(id)) continue;
    inside.add(id);
    for (const child of tree.nodes.get(id)?.childIds ?? []) stack.push(child);
  }
  let beside = 0;
  for (const id of tree.nodes.keys()) {
    if (!inside.has(id) && rules.lasting(id)) beside++;
  }
  return beside;
}

/** Whether dialog `dialogId` stands all but alone in `read`, in front of
 *  `rows` rows of the page: what shows beside it is at most half that. A
 *  dialog in content the page swapped in, a cookie banner, say, doesn't. */
function standsInFront<N extends TreeRow>(
  read: Tree<N>,
  dialogId: string,
  rows: number,
  rules: DialogRules<N>,
): boolean {
  return rowsBeside(read, dialogId, rules) * 2 <= rows;
}

/** `changes` without the rows that went: what a dialog in front of the
 *  page took out of the tree, while the page still holds them. A stop that was
 *  a stop for more than that (the dialog itself, new, which the rows that
 *  went are charged to as the tree's new root) stays one. */
function withoutRemovals(changes: TreeChanges): TreeChanges {
  return {
    ...changes,
    removed: [],
    removedUnder: new Map(),
    stops: changes.stops.filter(
      (id) =>
        !changes.removedUnder.has(id) ||
        changes.changed.has(id) ||
        changes.added.has(id),
    ),
  };
}

/**
 * The tree `read` is compared with, given `against` (the tree before its run)
 * and the dialogs open in front of the page: `against`, unless a dialog the
 * read doesn't show any more closed, then the tree from before the first
 * such dialog came, the dialogs still open with it. A dialog missing from a
 * read that brings a new one standing in front of the page went behind it
 * rather than away: a modal leaves only the dialog in front in the tree. One
 * that comes with the page back around it, a confirmation that the dialog
 * was saved, say, came as it closed.
 */
function closingDialogs<N extends TreeRow>(
  against: Tree<N>,
  dialogs: readonly OpenDialog<N>[],
  read: Tree<N>,
  rules: DialogRules<N>,
): { baseline: Tree<N>; dialogs: readonly OpenDialog<N>[] } {
  let shown = dialogs.length - 1;
  while (shown >= 0 && !read.nodes.has(dialogs[shown]!.dialogId)) shown--;
  if (shown === dialogs.length - 1) return { baseline: against, dialogs };
  const behind = dialogs[shown + 1]!.before;
  const known = (id: string) => dialogs.some((d) => d.dialogId === id);
  const opened = dialogsIn(read, rules).some(
    (id) =>
      !against.nodes.has(id) &&
      !known(id) &&
      standsInFront(read, id, behind.nodes.size, rules),
  );
  if (opened) return { baseline: against, dialogs };
  return { baseline: behind, dialogs: dialogs.slice(0, shown + 1) };
}

/** The dialog `read` brought in front of `baseline`, if it took at least
 *  half of it out of the tree with it, as a modal's does, and stands all
 *  but alone in front of what went. */
function dialogInFront<N extends TreeRow>(
  baseline: Tree<N>,
  read: Tree<N>,
  found: TreeChanges,
  rules: DialogRules<N>,
): string | undefined {
  const went = found.removed.length;
  if (went * 2 < baseline.nodes.size) return undefined;
  return dialogsIn(read, rules).find(
    (id) => !baseline.nodes.has(id) && standsInFront(read, id, went, rules),
  );
}

/** Whether a dialog `baseline` shows, and none of `dialogs` (it was never
 *  seen come), is gone from `read`. */
function unseenDialogGone<N extends TreeRow>(
  baseline: Tree<N>,
  read: Tree<N>,
  dialogs: readonly OpenDialog<N>[],
  rules: DialogRules<N>,
): boolean {
  return dialogsIn(baseline, rules).some(
    (id) => !read.nodes.has(id) && !dialogs.some((d) => d.dialogId === id),
  );
}

/**
 * What `read` found changed, compared with `context.against` (the tree
 * before its run) with `context.dialogs` open in front of the page. A dialog
 * the read finds in front stands in front of `context.onScreen`, the tree on
 * screen, when the read continues a run, and of what it was compared with
 * otherwise. Null when the read is the page back from behind a dialog never
 * seen open, which can't be told from the page swapping its content.
 */
export function compareThroughDialogs<N extends TreeRow>(
  read: Tree<N>,
  context: {
    against: Tree<N>;
    dialogs: readonly OpenDialog<N>[];
    onScreen?: Tree<N>;
  },
  rules: DialogRules<N>,
): DialogComparison<N> | null {
  const { baseline, dialogs } = closingDialogs(
    context.against,
    context.dialogs,
    read,
    rules,
  );
  const found = diffTreeRows(baseline, read, rules);
  const inFront = dialogInFront(baseline, read, found, rules);
  // The page back from behind a dialog never seen come: the dialog gone,
  // and most of the read new. The count first, as it costs nothing.
  if (
    !inFront &&
    found.added.size * 2 >= read.nodes.size &&
    unseenDialogGone(baseline, read, dialogs, rules)
  ) {
    return null;
  }
  const changes = inFront ? withoutRemovals(found) : found;
  const open =
    !inFront || dialogs.some((d) => d.dialogId === inFront)
      ? dialogs
      : [
          ...dialogs,
          { dialogId: inFront, before: context.onScreen ?? baseline },
        ];
  return {
    baseline,
    changes: isEmptyTreeChanges(changes) ? null : changes,
    dialogs: open,
  };
}
