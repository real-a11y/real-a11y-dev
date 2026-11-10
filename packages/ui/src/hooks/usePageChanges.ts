/**
 * The change marks for a tree read from the page it shows (`TreeView.tsx`):
 * each update of the tree is a read, compared as `tree-change-runs.ts`
 * compares reads, and `TreePanel.tsx` marks what it found.
 *
 * What the user does starts a run: a click or a key on the page, or an
 * action sent through the tree, but not a pick of the element picker, which
 * the page never sees. The updates in the {@link FOLLOW_MS} after
 * it follow it up, so they compare with the tree from before it, and what
 * they find is said. Typing in a field ends that, as it does in the
 * extension: a list that filters as the user types is marked, not said at
 * every key. Any other update is a run of its own, marked and not said, and
 * one that changes nothing the tree shows leaves the marks as they are. A
 * host that hears the page some other way, as the Storybook addon's panel
 * hears the story's frame, passes no document and tells `noteInput` instead.
 *
 * A checkpoint pins the tree it was taken of instead: every update compares
 * with it, and the marks show everything since.
 */

import { watchUserInput, type UserInput } from "@real-a11y-dev/core";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import {
  compareInRun,
  compareWithCheckpoint,
  type Checkpoint,
  type ReadRun,
  type RunBase,
} from "../tree-change-runs.js";
import type { DialogRules } from "../tree-changes-dialogs.js";
import {
  NO_TREE_CHANGES,
  type Tree,
  type TreeChanges,
  type TreeRow,
} from "../tree-changes-diff.js";
import type { ChangeMarks, TreeChangesProp } from "../tree-changes.js";

/** How long after the user acts the page's updates are what they did. */
export const FOLLOW_MS = 5000;

/** How soon after a press or a key a click is the same act: the press's
 *  click, or the one Enter or Space makes. */
const SAME_ACT_MS = 1000;

/** The clock the follow window runs on, which never steps back. */
const now = () => performance.now();

/** What the user does on the page, as `useUserOnPage` hears it. */
interface UserOnPage {
  /** A press or a key. */
  act: () => void;
  /** A click: a press's, or one with no press before it, as a screen
   *  reader's activation comes. */
  click: () => void;
  /** Typing in a field. */
  type: () => void;
  /** True while what the user does is for the panel, not the page; told
   *  which event, as only a press makes a click. */
  ignore: (type: string) => boolean;
}

/** Tells `on` what the user does on the page (`watchUserInput`). */
function useUserOnPage(
  doc: Document | null,
  listening: boolean,
  on: UserOnPage,
): void {
  useEffect(() => {
    if (!doc || !listening) return;
    return watchUserInput(doc, (input, e) => {
      if (!on.ignore(e.type)) on[input]();
    });
  }, [doc, listening, on]);
}

/**
 * The user acting starts a run that the next updates of `r` follow up, and
 * typing ends it. `ignore` is `UserOnPage.ignore`.
 */
function userActs(r: PageReads<TreeRow>, ignore: () => boolean): UserOnPage {
  // The last press a click can be the same act as, and the last one
  // ignored: its click is too, though what ignored it (a pick) may be over
  // by the time the click comes.
  let pressedAt = -Infinity;
  let ignoredAt = -Infinity;
  const act = () => {
    r.actedAt = pressedAt = now();
    r.followUntil = r.actedAt + FOLLOW_MS;
  };
  return {
    act,
    // A press's own click is the same act: moving the run on would part what
    // the press did from what the click does.
    click: () => {
      const t = now();
      if (t - pressedAt >= SAME_ACT_MS && t - ignoredAt >= SAME_ACT_MS) act();
    },
    // A key that typed makes no click: a click after it is an act of its own.
    type: () => {
      r.followUntil = Math.min(r.followUntil, now());
      pressedAt = -Infinity;
    },
    ignore: (type) => {
      const ignoring = ignore();
      if (ignoring && type === "pointerdown") ignoredAt = now();
      return ignoring;
    },
  };
}

/** What the marks are worked out from, kept across updates. */
interface PageReads<N extends TreeRow> {
  /** What the next update compares with, while no checkpoint is pinned. */
  base: RunBase<N> | null;
  checkpoint: Checkpoint<N> | null;
  /** The last update, where the changes bar's ✕ starts over from. */
  last: Tree<N> | null;
  /** When the user last acted, and until when updates follow it up. */
  actedAt: number;
  followUntil: number;
  seq: number;
}

/** The run an update at `at` is in: the one the user's last act began,
 *  while updates follow it up, and one of its own after. */
function runAt(r: PageReads<TreeRow>, at: number): ReadRun {
  return at < r.followUntil
    ? { follows: r.actedAt, announce: true }
    : { follows: null, announce: false };
}

/**
 * What the update that brought `read` in `run`, replacing `onScreen`,
 * leaves marked: what it found changed, null for nothing, or undefined to
 * leave the marks as they are. Moves `r` on to what the next update
 * compares with.
 */
function takeUpdate<N extends TreeRow>(
  r: PageReads<N>,
  update: { onScreen: Tree<N> | null; read: Tree<N>; run: ReadRun },
  { rules, live }: { rules: DialogRules<N>; live: boolean },
): TreeChanges | null | undefined {
  const { onScreen, read, run } = update;
  if (r.checkpoint) {
    const found = compareWithCheckpoint(read, r.checkpoint, rules);
    r.checkpoint = found.checkpoint;
    // Nothing since the checkpoint, after the user acted: said, as the
    // totals going down are (`TreeChangesProp.totals`).
    return found.changes ?? (run.announce ? NO_TREE_CHANGES : null);
  }
  if (!live || !onScreen) {
    r.base = null;
    return undefined;
  }
  const base = r.base ?? { follows: null, runBefore: onScreen, dialogs: [] };
  const found = compareInRun(read, { base, onScreen, run }, rules);
  r.base = found.base;
  // An update the user didn't cause that finds nothing the tree shows
  // changed leaves the marks: on a page that keeps changing where the tree
  // doesn't show it, they would go moments after what made them. Not one a
  // dialog closed in: the marks were the dialog's.
  if (
    found.compared &&
    !found.changes &&
    run.follows === null &&
    !found.closedDialog
  ) {
    return undefined;
  }
  return found.changes;
}

/**
 * The marks for the page `doc` shows, compared by `rules`: what the last
 * update found while `live`, or everything since the checkpoint while one is
 * pinned (`pin`). The tree's host calls `noteRead` with each update, and
 * `noteAction` as it sends an action through the tree; with no `doc`, it
 * calls `noteInput` with what the user does on the page.
 */
export function usePageChanges<N extends TreeRow>({
  rules,
  live,
  doc,
  ignoreInput = () => false,
}: {
  rules: DialogRules<N>;
  live: boolean;
  /** The page's document, which what the user does is heard on: null for a
   *  page the host hears another way. */
  doc: Document | null;
  /** True while what the user does on the page is for the panel, as a pick
   *  of the element picker is. */
  ignoreInput?: () => boolean;
}) {
  const [marks, setMarks] = useState<ChangeMarks | null>(null);
  const [pinned, setPinned] = useState(false);
  const reads = useRef<PageReads<N>>({
    base: null,
    checkpoint: null,
    last: null,
    actedAt: 0,
    followUntil: 0,
    seq: 0,
  });
  // Read when an update lands, which a callback made in an earlier render
  // takes in.
  const latest = useRef({ rules, live, ignoreInput });
  latest.current = { rules, live, ignoreInput };

  const [on] = useState(() =>
    userActs(reads.current, () => latest.current.ignoreInput()),
  );
  useUserOnPage(doc, live || pinned, on);

  // Turned off, the marks go, and the next update turned on again compares
  // with the tree on screen.
  useEffect(() => {
    if (live) return;
    reads.current.base = null;
    if (!reads.current.checkpoint) setMarks(null);
  }, [live]);

  /**
   * An update brought `read`, which replaces `onScreen`: null for the first
   * update of a tree read afresh, which nothing is compared with.
   */
  const noteRead = useCallback((onScreen: Tree<N> | null, read: Tree<N>) => {
    const r = reads.current;
    r.last = read;
    const run = runAt(r, now());
    const found = takeUpdate(r, { onScreen, read, run }, latest.current);
    if (found === undefined) return;
    setMarks(found && { changes: found, seq: ++r.seq, announce: run.announce });
  }, []);

  /** What the user did on the page, for a host that passes no `doc`. */
  const noteInput = useCallback((input: UserInput) => on[input](), [on]);

  /** Pin `tree` as the checkpoint, or none. Either way the marks go:
   *  nothing has changed since a checkpoint just taken. */
  const pin = useCallback((tree: Tree<N> | null) => {
    reads.current.checkpoint = tree && { tree, dialogs: [] };
    reads.current.base = null;
    setPinned(tree !== null);
    setMarks(null);
  }, []);

  /** The changes bar's ✕: the marks go, and the next update compares with
   *  the tree as it is now, the checkpoint moved to it if one is pinned. */
  const clear = useCallback(() => {
    const r = reads.current;
    setMarks(null);
    if (!r.last) return;
    if (r.checkpoint) r.checkpoint = { tree: r.last, dialogs: [] };
    else if (r.base) r.base = { ...r.base, runBefore: r.last };
  }, []);

  /** Start over, for a tree of another kind or of another root: nothing
   *  read so far is comparable with it. */
  const reset = useCallback(() => {
    const r = reads.current;
    r.base = null;
    r.checkpoint = null;
    r.last = null;
    setPinned(false);
    setMarks(null);
  }, []);

  return {
    marks,
    pinned,
    noteRead,
    noteAction: on.act,
    noteInput,
    pin,
    clear,
    reset,
  };
}

/** What the change marks are compared with, in the tree's words. */
const SINCE_UPDATE_BEFORE = "the update before";
const SINCE_CHECKPOINT = "the checkpoint";

/** What a panel marks of `changes` (`usePageChanges`): what each update
 *  found while `live`, and what changed since the checkpoint while one is
 *  pinned, `live` or not. */
export function shownChanges(
  changes: { marks: ChangeMarks | null; pinned: boolean; clear: () => void },
  live: boolean,
): TreeChangesProp | undefined {
  if (!live && !changes.pinned) return undefined;
  if (!changes.pinned) {
    return {
      marks: changes.marks,
      clear: changes.clear,
      since: SINCE_UPDATE_BEFORE,
    };
  }
  // A click after the checkpoint is said with all it counts, so it says
  // what it counts from.
  return {
    marks: changes.marks,
    clear: changes.clear,
    since: SINCE_CHECKPOINT,
    noticeEnd: `since ${SINCE_CHECKPOINT}`,
    totals: true,
  };
}
