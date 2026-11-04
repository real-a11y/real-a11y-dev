/**
 * Which two trees a read of Chrome's tree compares, for the changes the
 * tree marks (`tree-changes.ts`), kept for `App.tsx`.
 *
 * A read compares the tree it brings with the tree before its run of
 * reads. A read the user causes starts a run (Refresh, or an action or a key
 * sent through the tree), and so does an automatic one. A read that follows
 * up what the user did (`follow-window.ts`) joins the run of the follow
 * window it is in, so what a click's first read found stays marked when a
 * later read finds the rest of it: a menu's button that went `expanded`, then
 * the items the page fetched for it. Only within one document: the same id
 * names the same element in no other.
 *
 * A modal dialog takes the rest of the page out of Chrome's tree while it is
 * open, as it does for a screen reader: a native `<dialog>` opened with
 * `showModal()`, or one whose page a library hides with `aria-hidden` or
 * `inert` (Radix, and so shadcn/ui). That isn't the page removing anything.
 * So a read that brings a dialog while at least half the tree it is compared
 * with leaves, the dialog all but alone in it (`standsInFront`), marks what
 * is new and nothing removed, and keeps that tree; the
 * read the dialog is gone from compares with it, so what shows is what the
 * dialog changed on the page. A dialog opened over another keeps the outer
 * one's tree the same way, so closing it compares with the outer dialog.
 * Whether Chrome marks a dialog `modal` doesn't decide it: a library's
 * modal isn't marked, and an `aria-modal` dialog that leaves the page in the
 * tree, or a modal inside a frame, is.
 */

import { useCallback, useRef, useState } from "preact/hooks";

import type { NativeNode } from "../native/native-actions.js";
import {
  diffNativeTrees,
  isEmptyNativeChanges,
  isLastingNativeId,
  type NativeTreeChanges,
} from "../native/native-tree-diff.js";

import type { FollowWindow } from "./follow-window.js";
import type { NativeChangeMarks } from "./tree-changes.js";

/** The run of reads a read is in, and whether what it finds is said. */
export interface ReadRun {
  /**
   * The run, named by when it began: when the read the user caused that
   * began it started, where the follow window that read opens starts too
   * (`followAfterRead`), or when the user last clicked or pressed a key on
   * the page in the follow window. Null for an automatic read, a run of its
   * own.
   */
  follows: number | null;
  announce: boolean;
}

/** What `readRun` needs of auto-refresh's state as a read starts. */
export interface ReadStart {
  lastReadStartedAt: number;
  follow: FollowWindow;
}

/** The run of a read, from auto-refresh's state as it starts. */
export function readRun(
  auto: boolean,
  followsAction: boolean,
  start: ReadStart,
): ReadRun {
  if (!auto) return { follows: start.lastReadStartedAt, announce: true };
  return followsAction
    ? { follows: followedGesture(start.follow), announce: true }
    : { follows: null, announce: false };
}

/** What the user did that a follow window's reads follow up, named by when
 *  they did it: what opened the window, or their latest click or key on the
 *  page since. A click inside an open window only stretches it
 *  (`followPageInput`), but it is a gesture of its own, whose reads show
 *  what changed since the read before it, not since the first click. */
function followedGesture(w: FollowWindow): number {
  return Math.max(w.from, w.actedAt);
}

/** A tree and the root it is drawn from. A document's reads don't always
 *  share a root: Chromium's own is dropped, so a page with one landmark is
 *  rooted at it, one with more at the synthetic `ax-root`, and an open modal
 *  dialog leaves only itself (`rootIdOf`). */
export interface Tree {
  nodes: Map<string, NativeNode>;
  rootId: string;
}

/** A read: its tree, and the tab and document it is of. */
export interface ReadTree extends Tree {
  tabId: number;
  documentId: string | undefined;
  /** Another document took the one it began on's place as it was read
   *  (`read-document.ts`): its rows are of neither. */
  documentChanged?: boolean;
}

/** What the next read is compared with. */
export interface ChangeBase {
  /** The read on screen: its tab, document, root, and run. */
  tabId: number;
  documentId: string | undefined;
  rootId: string;
  follows: number | null;
  /** The tree before the run's first read. */
  runBefore: Tree;
  /** The dialogs that took the rest of the tree out of Chrome's, outermost
   *  first, each with the tree from before it came. */
  dialogs: readonly OpenDialog[];
}

/** A dialog in front of the rest of the tree, and the tree from before it. */
export interface OpenDialog {
  dialogId: string;
  before: Tree;
}

/** The dialogs a tree shows. */
function dialogsIn(tree: Tree): string[] {
  const ids: string[] = [];
  for (const node of tree.nodes.values()) {
    if (node.role === "dialog" || node.role === "alertdialog")
      ids.push(node.id);
  }
  return ids;
}

/** How many rows `tree` shows beside dialog `dialogId`, outside its
 *  subtree: none for a `showModal()` dialog, a live region or two for one
 *  a library left the page's rest hidden beside. The synthetic root, and
 *  any other row that doesn't last, is no row of the page's. */
function rowsBeside(tree: Tree, dialogId: string): number {
  const inside = new Set<string>();
  const stack = [dialogId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (inside.has(id)) continue;
    inside.add(id);
    stack.push(...(tree.nodes.get(id)?.childIds ?? []));
  }
  let beside = 0;
  for (const id of tree.nodes.keys()) {
    if (!inside.has(id) && isLastingNativeId(id)) beside++;
  }
  return beside;
}

/** Whether dialog `dialogId` stands all but alone in `read`, in front of
 *  `rows` rows of the page: what shows beside it is at most half that. A
 *  dialog in content the page swapped in, a cookie banner, say, doesn't. */
function standsInFront(read: Tree, dialogId: string, rows: number): boolean {
  return rowsBeside(read, dialogId) * 2 <= rows;
}

/** `changes` without the rows that went: what a dialog in front of the
 *  page took out of the tree, while the page still holds them. A stop that was
 *  a stop for more than that (the dialog itself, new, which the rows that
 *  went are charged to as the tree's new root) stays one. */
function withoutRemovals(changes: NativeTreeChanges): NativeTreeChanges {
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

/** Whether `read` is of the document the tree on screen is of, as surely
 *  as can be told: with no tree on screen, no document id, or one that
 *  changed as the read was taken, it can't be. */
function sameDocument(
  base: ChangeBase | null,
  shown: Map<string, NativeNode>,
  read: ReadTree,
): base is ChangeBase {
  return (
    base !== null &&
    shown.size > 0 &&
    read.documentId !== undefined &&
    !read.documentChanged &&
    base.tabId === read.tabId &&
    base.documentId === read.documentId
  );
}

/**
 * The tree `read` is compared with, given `against` (the tree before its run)
 * and the dialogs open in front of the page: `against`, unless a dialog the
 * read doesn't show any more closed, then the tree from before the first
 * such dialog came, the dialogs still open with it. A dialog missing from a
 * read that brings a new one standing in front of the page went behind it
 * rather than away: Chromium keeps only the dialog in front. One that comes
 * with the page back around it, a confirmation that the dialog was saved,
 * say, came as it closed.
 */
function closingDialogs(
  against: Tree,
  dialogs: readonly OpenDialog[],
  read: Tree,
): { baseline: Tree; dialogs: readonly OpenDialog[] } {
  let shown = dialogs.length - 1;
  while (shown >= 0 && !read.nodes.has(dialogs[shown]!.dialogId)) shown--;
  if (shown === dialogs.length - 1) return { baseline: against, dialogs };
  const behind = dialogs[shown + 1]!.before;
  const known = (id: string) => dialogs.some((d) => d.dialogId === id);
  const opened = dialogsIn(read).some(
    (id) =>
      !against.nodes.has(id) &&
      !known(id) &&
      standsInFront(read, id, behind.nodes.size),
  );
  if (opened) return { baseline: against, dialogs };
  return { baseline: behind, dialogs: dialogs.slice(0, shown + 1) };
}

/** The dialog `read` brought in front of `baseline`, if it took at least
 *  half of it out of the tree with it, as a modal's does, and stands all
 *  but alone in front of what went. */
function dialogInFront(
  baseline: Tree,
  read: Tree,
  found: NativeTreeChanges,
): string | undefined {
  const went = found.removed.length;
  if (went * 2 < baseline.nodes.size) return undefined;
  return dialogsIn(read).find(
    (id) => !baseline.nodes.has(id) && standsInFront(read, id, went),
  );
}

/** Whether `read` is the page back from behind a dialog this panel never
 *  saw come: the dialog gone, and most of the read new. */
function backFromUnseenDialog(
  baseline: Tree,
  read: Tree,
  found: NativeTreeChanges,
  dialogs: readonly OpenDialog[],
): boolean {
  if (found.added.size * 2 < read.nodes.size) return false;
  return dialogsIn(baseline).some(
    (id) => !read.nodes.has(id) && !dialogs.some((d) => d.dialogId === id),
  );
}

/**
 * What `read` found changed, in `run`, and the base the next read compares
 * with. `shown` is the tree on screen, which `read` replaces: what a read
 * that starts a run compares with. Nothing is found when there is no tree on
 * screen, it is of another document, or which document the read is of is in
 * doubt; `compared` tells that from a read compared that found nothing.
 */
export function compareRead(
  base: ChangeBase | null,
  shown: Map<string, NativeNode>,
  read: ReadTree,
  run: ReadRun,
): {
  base: ChangeBase;
  changes: NativeTreeChanges | null;
  compared: boolean;
} {
  const next: ChangeBase = {
    tabId: read.tabId,
    documentId: read.documentId,
    rootId: read.rootId,
    follows: run.follows,
    runBefore: read,
    dialogs: [],
  };
  if (!sameDocument(base, shown, read)) {
    return { base: next, changes: null, compared: false };
  }
  const continues = run.follows !== null && run.follows === base.follows;
  const against = continues
    ? base.runBefore
    : { nodes: shown, rootId: base.rootId };
  const { baseline, dialogs } = closingDialogs(against, base.dialogs, read);
  const found = diffNativeTrees(
    baseline.nodes,
    read.nodes,
    read.rootId,
    baseline.rootId,
  );
  const inFront = dialogInFront(baseline, read, found);
  if (!inFront && backFromUnseenDialog(baseline, read, found, dialogs)) {
    return { base: next, changes: null, compared: false };
  }
  const changes = inFront ? withoutRemovals(found) : found;
  // A dialog stands in front of the tree on screen as it came, which a
  // follow-up of the run doesn't compare with: a second dialog the page
  // opened over the first keeps the first, not the page behind both.
  const before = continues ? { nodes: shown, rootId: base.rootId } : baseline;
  const open =
    !inFront || dialogs.some((d) => d.dialogId === inFront)
      ? dialogs
      : [...dialogs, { dialogId: inFront, before }];
  return {
    base: { ...next, runBefore: baseline, dialogs: open },
    changes: isEmptyNativeChanges(changes) ? null : changes,
    compared: true,
  };
}

/** Which document a read is of, as one string: its tab and its document,
 *  and whether another took that one's place as it was read, which makes
 *  its rows of neither. Where Chromium names no document, its URL stands
 *  in, so a navigation still leads to another. */
export function documentKeyOf(
  tabId: number,
  r: { documentId?: string; documentChanged?: boolean; url?: string },
): string {
  const which = r.documentId ?? `url ${r.url ?? ""}`;
  return `${tabId} ${which}${r.documentChanged ? " changed" : ""}`;
}

/** The marks for the tree on screen, `nodes`, what changes them, and which
 *  document the tree is of. */
export function useNativeChanges(nodes: Map<string, NativeNode>) {
  const [changes, setChanges] = useState<NativeChangeMarks | null>(null);
  const [documentKey, setDocumentKey] = useState<string>();
  const seq = useRef(0);
  const base = useRef<ChangeBase | null>(null);
  // The tree on screen, as of the last render: a read replaces it after it
  // is compared. While there is none (after a navigation, a tab switch or a
  // failed read), nothing is marked, and the run's tree is forgotten, so no
  // read compares with it. In the render, not an effect, which a read
  // landing first could race.
  const shown = useRef(nodes);
  shown.current = nodes;
  if (nodes.size === 0) base.current = null;

  /** A read of `tabId` came back with `r`, its tree `read`, in `run`.
   *  Called before the tree on screen is replaced. Its identity never
   *  changes, so a callback that holds it needn't list it. */
  const noteRead = useCallback(
    (
      tabId: number,
      r: {
        rootId?: string;
        documentId?: string;
        documentChanged?: boolean;
        url?: string;
      },
      read: Map<string, NativeNode>,
      run: ReadRun,
    ) => {
      const next = compareRead(
        base.current,
        shown.current,
        {
          tabId,
          documentId: r.documentId,
          documentChanged: r.documentChanged,
          rootId: r.rootId ?? "",
          nodes: read,
        },
        run,
      );
      base.current = next.base;
      setDocumentKey(documentKeyOf(tabId, r));
      // An automatic read of the page's own changes that finds none in the
      // tree leaves the marks: on a page that keeps changing where the tree
      // doesn't show it, they would go moments after the action that made
      // them. A read the user caused that finds none takes them away.
      if (next.compared && !next.changes && run.follows === null) return;
      setChanges(
        next.changes && {
          changes: next.changes,
          seq: ++seq.current,
          announce: run.announce,
        },
      );
    },
    [],
  );

  /** The changes bar's ✕: the marks go, and a read that follows up the same
   *  run compares with the tree as it is now, so they don't come back. */
  const clear = useCallback(() => {
    setChanges(null);
    const b = base.current;
    if (b) b.runBefore = { nodes: shown.current, rootId: b.rootId };
  }, []);

  return {
    marks: nodes.size > 0 ? changes : null,
    noteRead,
    clear,
    documentKey,
  };
}
