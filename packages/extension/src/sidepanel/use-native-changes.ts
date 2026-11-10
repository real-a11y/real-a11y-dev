/**
 * Which two trees a read of Chrome's tree compares, for the changes the
 * tree marks (the ui package's `tree-changes.ts`), kept for `App.tsx`.
 *
 * A read compares the tree it brings with the tree before its run of
 * reads. A read the user causes starts a run (Refresh, or an action or a key
 * sent through the tree), and so does an automatic one. A read that follows
 * up what the user did (`follow-window.ts`) joins the run of the follow
 * window it is in, so what a click's first read found stays marked when a
 * later read finds the rest of it: a menu's button that went `expanded`, then
 * the items the page fetched for it. Only within one document: the same id
 * names the same element in no other. Within one, a read is compared as the
 * shared panel compares the updates of a live tree (the ui package's
 * `tree-change-runs.ts`).
 *
 * A modal dialog takes the rest of the page out of Chrome's tree while it is
 * open, which isn't the page removing anything: the ui package's
 * `tree-changes-dialogs.ts` picks the tree a read compares with around one.
 */

import {
  compareInRun,
  type ChangeMarks,
  type ReadRun,
  type RunBase,
  type Tree,
  type TreeChanges,
} from "@real-a11y-dev/semantic-navigator-ui";
import { useCallback, useRef, useState } from "preact/hooks";

import type { NativeNode } from "../native/native-actions.js";
import { NATIVE_TREE_RULES } from "../native/native-tree-diff.js";

import type { FollowWindow } from "./follow-window.js";

/**
 * The run of reads a read is in (the ui package's `ReadRun`), and whether
 * what it finds is said. A run is named by when it began: when the read the
 * user caused that began it started, where the follow window that read opens
 * starts too (`followAfterRead`), or when the user last clicked or pressed a
 * key on the page in the follow window. An automatic read is a run of its
 * own.
 */
export type { ReadRun };

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

/** A read: its tree, and the tab and document it is of. A document's reads
 *  don't always share a root: Chromium's own is dropped, so a page with one
 *  landmark is rooted at it, one with more at the synthetic `ax-root`, and
 *  an open modal dialog leaves only itself (`rootIdOf`). */
export interface ReadTree extends Tree<NativeNode> {
  tabId: number;
  documentId: string | undefined;
  /** Another document took the one it began on's place as it was read
   *  (`read-document.ts`): its rows are of neither. */
  documentChanged?: boolean;
}

/** What the next read is compared with: the run's (the ui package's
 *  `RunBase`), and the tab, document and root of the read on screen. */
export interface ChangeBase extends RunBase<NativeNode> {
  tabId: number;
  documentId: string | undefined;
  rootId: string;
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
  changes: TreeChanges | null;
  compared: boolean;
  closedDialog: boolean;
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
    return { base: next, changes: null, compared: false, closedDialog: false };
  }
  const found = compareInRun(
    read,
    { base, onScreen: { nodes: shown, rootId: base.rootId }, run },
    NATIVE_TREE_RULES,
  );
  return { ...found, base: { ...next, ...found.base } };
}

/**
 * Which document a read is of, as one string: its tab and its document, and
 * whether another took that one's place as it was read, which makes its rows
 * of neither. Where Chromium names no document, `emptied` stands in: how many
 * times the tree on screen has gone, which every navigation to another
 * document does (`PAGE_NAVIGATED`) and a change of URL within one doesn't.
 * A URL couldn't: a reload keeps it, and a page's own routing changes it.
 * A failed read that clears the tree counts too, as it does for the marks,
 * which forget the tree they compared with: a read fails when the page goes
 * as it is read, and with no document to go by, taking a page for a new one
 * only closes rows, where taking a new page for the old one would open the
 * old one's ids on it and leave its own first rows closed.
 *
 * @internal
 */
export function documentKeyOf(
  tabId: number,
  r: { documentId?: string; documentChanged?: boolean },
  emptied: number,
): string {
  const which = r.documentId ?? `emptied ${emptied}`;
  return `${tabId} ${which}${r.documentChanged ? " changed" : ""}`;
}

/** The marks for the tree on screen, `nodes`, what changes them, and which
 *  document the tree is of. */
export function useNativeChanges(nodes: Map<string, NativeNode>) {
  const [changes, setChanges] = useState<ChangeMarks | null>(null);
  const [documentKey, setDocumentKey] = useState<string>();
  const seq = useRef(0);
  const base = useRef<ChangeBase | null>(null);
  // The tree on screen, as of the last render: a read replaces it after it
  // is compared. While there is none (after a navigation, a tab switch or a
  // failed read), nothing is marked, and the run's tree is forgotten, so no
  // read compares with it. In the render, not an effect, which a read
  // landing first could race.
  const shown = useRef(nodes);
  // How many times it has gone: see `documentKeyOf`.
  const emptied = useRef(0);
  if (nodes.size === 0 && shown.current.size > 0) emptied.current++;
  shown.current = nodes;
  if (nodes.size === 0) base.current = null;

  /** A read of `tabId` came back with `r`, its tree `read`, in `run`.
   *  Called before the tree on screen is replaced. Its identity never
   *  changes, so a callback that holds it needn't list it. */
  const noteRead = useCallback(
    (
      tabId: number,
      r: { rootId?: string; documentId?: string; documentChanged?: boolean },
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
      setDocumentKey(documentKeyOf(tabId, r, emptied.current));
      // An automatic read of the page's own changes that finds none in the
      // tree leaves the marks: on a page that keeps changing where the tree
      // doesn't show it, they would go moments after the action that made
      // them. A read the user caused that finds none takes them away, and
      // so does one a dialog closed in: the marks were the dialog's.
      if (
        next.compared &&
        !next.changes &&
        run.follows === null &&
        !next.closedDialog
      ) {
        return;
      }
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
