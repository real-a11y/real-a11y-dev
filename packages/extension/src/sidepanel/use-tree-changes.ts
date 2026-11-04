/**
 * The changes Chrome's tree marks, as `NativeTreeView.tsx` shows them
 * (`tree-changes.ts`): the rows a read finds new or changed flash for a
 * moment, the new ones open, in the render that brings the read, a read the
 * user caused says what it found, and Alt+N goes from change to change.
 */

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "preact/hooks";

import type { NativeNode } from "../native/native-actions.js";
import type { NativeTreeChanges } from "../native/native-tree-diff.js";

import {
  documentPositions,
  firstFlashEnd,
  flashesLeft,
  flashFresh,
  freshChanges,
  hiddenChangesByRow,
  nextChangeStop,
  NO_FLASH,
  notAboveSelection,
  rowsToOpen,
  summarizeChanges,
  type NativeChangeMarks,
} from "./tree-changes.js";
import { opened } from "./use-tree-expansion.js";

/** What the polite region under the toolbar says, keyed so the same words
 *  twice are said twice. */
export interface ChangeNotice {
  text: string;
  key: number;
}

/** The clock a flash's end is on: the one timers run on, which, unlike
 *  the wall clock, never steps back. */
const now = () => performance.now();

/** No row placed: nothing marked to go to. */
const NO_POSITIONS: ReadonlyMap<string, number> = new Map();

/** The rows flashing, each until its own end, on one timer for the flash
 *  that ends first. `flash` starts the rows a read found fresh; `stop`
 *  ends them all. */
function useFlashes() {
  const [flashes, setFlashes] = useState(NO_FLASH);
  useEffect(() => {
    if (flashes.size === 0) return;
    const timer = setTimeout(
      () => setFlashes((flashing) => flashesLeft(flashing, now())),
      Math.max(0, firstFlashEnd(flashes) - now()),
    );
    return () => clearTimeout(timer);
  }, [flashes]);
  const flash = useCallback((fresh: ReadonlySet<string>) => {
    setFlashes((flashing) => flashFresh(flashing, fresh, now()));
  }, []);
  const stop = useCallback(() => setFlashes(NO_FLASH), []);
  return { flashes, flash, stop };
}

/** What a read finds that the read before it didn't, and the rows that
 *  opens. */
interface FreshRead {
  fresh: ReadonlySet<string>;
  open: string[];
}

const NOTHING_FRESH: FreshRead = { fresh: new Set(), open: [] };

/** What `changes` found that `prev`, the marks before them, didn't, and the
 *  rows that opens, none above the selection. No `prev` at all is a view
 *  mounting with marks it didn't see arrive: nothing is fresh. */
function freshRead(
  prev: NativeTreeChanges | null | undefined,
  changes: NativeChangeMarks | null,
  tree: {
    nodes: Map<string, NativeNode>;
    rootId: string;
    parentOf: Map<string, string>;
  },
  selectedId: string | null,
): FreshRead {
  if (prev === undefined || !changes) return NOTHING_FRESH;
  const fresh = freshChanges(prev, changes.changes);
  if (fresh.size === 0) return NOTHING_FRESH;
  const open = notAboveSelection(
    rowsToOpen(changes.changes, fresh, tree.nodes, tree.parentOf),
    tree,
    selectedId,
  );
  return { fresh, open };
}

export function useTreeChanges({
  changes,
  nodes,
  rootId,
  parentOf,
  selectedId,
  expanded,
  setExpanded,
  jumpTo,
}: {
  changes: NativeChangeMarks | null;
  nodes: Map<string, NativeNode>;
  rootId: string;
  parentOf: Map<string, string>;
  selectedId: string | null;
  /** The rows open (`use-tree-expansion.ts`). */
  expanded: Set<string>;
  setExpanded: (update: (open: Set<string>) => Set<string>) => void;
  /** Select a row wherever it is, as a jump chip does. */
  jumpTo: (id: string) => void;
}) {
  const shown = changes?.changes ?? null;
  const { flashes, flash, stop } = useFlashes();
  const [notice, setNotice] = useState<ChangeNotice | null>(null);
  const noticeKey = useRef(0);
  const say = useCallback((text: string) => {
    setNotice({ text, key: ++noticeKey.current });
  }, []);

  // The marks the layout effect below last took in. Marks the view mounts
  // with are a read it didn't see arrive: they show, but neither flash, nor
  // open anything, nor speak again.
  const last = useRef<NativeTreeChanges | null | undefined>(undefined);
  // Worked out in the render that brings the read, so the rows it opens are
  // open in that render rather than from the next. That render's plain
  // effects run as the next one starts, among them the one that drops a
  // selection it can't see: a new row holding the selected one, still closed
  // for them, would take the selection with it. The rest is read here rather
  // than listed as dependencies: it arrives with the marks, and a change to
  // it alone isn't a read.
  const read = useMemo(
    () =>
      freshRead(last.current, changes, { nodes, rootId, parentOf }, selectedId),
    [changes?.seq],
  );
  // On top of the rows open until the layout effect adds them there, where
  // the user can close them again.
  const pending = last.current === shown ? NOTHING_FRESH.open : read.open;
  const open = useMemo(() => opened(expanded, pending), [expanded, pending]);

  // Before paint, so a marked row never shows a frame without its flash.
  // Marks that go take what was said about them along.
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = shown;
    if (prev === undefined || !changes) {
      stop();
      if (prev !== undefined) setNotice(null);
      return;
    }
    if (read.fresh.size === 0) return;
    flash(read.fresh);
    if (read.open.length > 0) {
      setExpanded((prevOpen) => opened(prevOpen, read.open));
    }
    if (changes.announce) {
      say(`${summarizeChanges(changes.changes)} in the tree`);
    }
  }, [changes?.seq]);

  // Each row's place in the tree, once for the marks rather than at every
  // press of the keys below.
  const positions = useMemo(
    () => (shown ? documentPositions(nodes, rootId) : NO_POSITIONS),
    [shown, nodes, rootId],
  );

  // Alt+N and Alt+Shift+N, and the changes bar's arrows: the next or
  // previous change, wherever it is — opened up to, as a jump chip's
  // target is. Landing on the row already selected moves nothing a screen
  // reader would hear, so that says so.
  const goToChange = useCallback(
    (back: boolean) => {
      const target = nextChangeStop(
        shown?.stops ?? [],
        positions,
        selectedId,
        back,
      );
      if (target === undefined) {
        say("No changes since the read before");
        return;
      }
      if (target === selectedId) say("This is the only change");
      jumpTo(target);
    },
    [shown, positions, selectedId, jumpTo, say],
  );

  return { shown, flashes, notice, goToChange, expanded: open };
}

/**
 * The changes each shown row stands in for, under it but without a row on
 * screen: under a collapsed row, or left out by a search. `visibleIds` is
 * every row the tree shows, scrolled to or not.
 */
export function useHiddenChanges(
  { shown, flashes }: ReturnType<typeof useTreeChanges>,
  visibleIds: string[],
  parentOf: Map<string, string>,
) {
  return useMemo(
    () =>
      shown &&
      hiddenChangesByRow(shown, new Set(visibleIds), parentOf, flashes),
    [shown, visibleIds, parentOf, flashes],
  );
}
