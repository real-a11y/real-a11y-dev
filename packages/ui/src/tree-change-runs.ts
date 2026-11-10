/**
 * Which tree a read compares with, for the change marks (`tree-changes.ts`):
 * the tree before its run of reads, or the tree on screen, which it replaces.
 *
 * A read the user caused starts a run, and the reads that follow up what they
 * did join it, so what the first of them found stays marked when a later one
 * finds the rest: a menu's button that went `expanded`, then the items the
 * page fetched for it. Any other read is a run of its own. While a dialog
 * stands in front of the page, `tree-changes-dialogs.ts` picks the tree.
 *
 * The extension's reads of Chrome's tree (`use-native-changes.ts`) and the
 * shared panel's updates of a live tree (`hooks/usePageChanges.ts`) both
 * compare this way.
 */

import {
  compareThroughDialogs,
  type DialogRules,
  type OpenDialog,
} from "./tree-changes-dialogs.js";
import type { Tree, TreeChanges, TreeRow } from "./tree-changes-diff.js";

/** The run of reads a read is in, and whether what it finds is said. */
export interface ReadRun {
  /**
   * The run, named by when what the user did that began it happened. Null
   * for a read nobody caused, a run of its own.
   */
  follows: number | null;
  announce: boolean;
}

/** What the next read is compared with. */
export interface RunBase<N extends TreeRow> {
  /** The run of the read before (`ReadRun.follows`). */
  follows: number | null;
  /** The tree before the run's first read. */
  runBefore: Tree<N>;
  /** The dialogs that took the rest of the tree out of it, outermost
   *  first, each with the tree from before it came. */
  dialogs: readonly OpenDialog<N>[];
}

/**
 * What `read`, in `run`, found changed since `base`, the reads before it,
 * with `onScreen` the tree it replaces, and the base the read after it
 * compares with. A read that continues the run of the read before compares
 * with the tree before that run; any other, with the tree on screen.
 * `compared` is false for a read that can't be compared, the page back from
 * behind a dialog never seen come, which starts afresh from it.
 * `closedDialog` is true for one a dialog closed in, compared with the tree
 * from before it: what was marked was the dialog's, gone with it.
 */
export function compareInRun<N extends TreeRow>(
  read: Tree<N>,
  context: { base: RunBase<N>; onScreen: Tree<N>; run: ReadRun },
  rules: DialogRules<N>,
): {
  base: RunBase<N>;
  changes: TreeChanges | null;
  compared: boolean;
  closedDialog: boolean;
} {
  const { base, onScreen, run } = context;
  const continues = run.follows !== null && run.follows === base.follows;
  const found = compareThroughDialogs(
    read,
    {
      against: continues ? base.runBefore : onScreen,
      dialogs: base.dialogs,
      // A dialog stands in front of the tree on screen as it came, which a
      // follow-up of the run doesn't compare with: a second dialog the page
      // opened over the first keeps the first, not the page behind both.
      ...(continues ? { onScreen } : {}),
    },
    rules,
  );
  if (!found) {
    return {
      base: { follows: run.follows, runBefore: read, dialogs: [] },
      changes: null,
      compared: false,
      closedDialog: false,
    };
  }
  return {
    base: {
      follows: run.follows,
      runBefore: found.baseline,
      dialogs: found.dialogs,
    },
    changes: found.changes,
    compared: true,
    closedDialog: found.dialogs.length < base.dialogs.length,
  };
}

/** A tree every read compares with, as the shared panel's checkpoint is,
 *  and the dialogs in front of the page since it was taken. */
export interface Checkpoint<N extends TreeRow> {
  tree: Tree<N>;
  dialogs: readonly OpenDialog<N>[];
}

/**
 * What `read` found changed since `checkpoint`, and the checkpoint the read
 * after it compares with: the same tree, whatever dialog opens or closes in
 * between, unless `read` is the page back from behind a dialog never seen
 * come, which the checkpoint moves to.
 */
export function compareWithCheckpoint<N extends TreeRow>(
  read: Tree<N>,
  checkpoint: Checkpoint<N>,
  rules: DialogRules<N>,
): { checkpoint: Checkpoint<N>; changes: TreeChanges | null } {
  // No tree on screen to stand a dialog in front of: one the page opens
  // stands in front of the checkpoint, so the page behind it, once it
  // closes, is compared with the checkpoint again.
  const found = compareThroughDialogs(
    read,
    { against: checkpoint.tree, dialogs: checkpoint.dialogs },
    rules,
  );
  if (!found) return { checkpoint: { tree: read, dialogs: [] }, changes: null };
  return {
    checkpoint: { tree: checkpoint.tree, dialogs: found.dialogs },
    changes: found.changes,
  };
}
