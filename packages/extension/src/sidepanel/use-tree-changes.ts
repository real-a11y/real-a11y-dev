/**
 * The changes Chrome's tree marks, as `NativeTreeView.tsx` shows them
 * (`tree-changes.ts`): the rows a read finds new or changed flash for a
 * moment, the new ones open, a read the user caused says what it found,
 * and Alt+N goes from change to change.
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

/** What the polite region under the toolbar says, keyed so the same words
 *  twice are said twice. */
export interface ChangeNotice {
  text: string;
  key: number;
}

/** The clock a flash's end is on: the one timers run on, which, unlike
 *  the wall clock, never steps back. */
const now = () => performance.now();

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

/** `open` added to the rows open, the same set back when it adds nothing. */
function opened(prev: Set<string>, open: string[]): Set<string> {
  let next: Set<string> | null = null;
  for (const id of open) {
    if (!prev.has(id)) (next ??= new Set(prev)).add(id);
  }
  return next ?? prev;
}

export function useTreeChanges({
  changes,
  nodes,
  rootId,
  parentOf,
  visibleIds,
  selectedId,
  setExpanded,
  jumpTo,
}: {
  changes: NativeChangeMarks | null;
  nodes: Map<string, NativeNode>;
  rootId: string;
  parentOf: Map<string, string>;
  /** Every row the tree shows, scrolled to or not. */
  visibleIds: string[];
  selectedId: string | null;
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

  // Before paint, so a marked row never shows a frame without its flash.
  // Marks the view mounts with are a read it didn't see arrive: they show,
  // but neither flash nor speak again. Marks that go take what was said
  // about them along.
  const last = useRef<NativeTreeChanges | null | undefined>(undefined);
  useLayoutEffect(() => {
    const prev = last.current;
    last.current = shown;
    if (prev === undefined || !changes) {
      stop();
      if (prev !== undefined) setNotice(null);
      return;
    }
    const fresh = freshChanges(prev, changes.changes);
    if (fresh.size === 0) return;
    flash(fresh);
    // Read here rather than listed as dependencies: they arrive with the
    // marks, and a change to them alone isn't a read.
    const open = notAboveSelection(
      rowsToOpen(changes.changes, fresh, nodes, parentOf),
      { nodes, rootId, parentOf },
      selectedId,
    );
    if (open.length > 0) setExpanded((prevOpen) => opened(prevOpen, open));
    if (changes.announce) {
      say(`${summarizeChanges(changes.changes)} in the tree`);
    }
  }, [changes?.seq]);

  // The changes each shown row stands in for, under it but without a row on
  // screen: under a collapsed row, or left out by a search.
  const hidden = useMemo(
    () =>
      shown &&
      hiddenChangesByRow(shown, new Set(visibleIds), parentOf, flashes),
    [shown, visibleIds, parentOf, flashes],
  );

  // Alt+N and Alt+Shift+N, and the changes bar's arrows: the next or
  // previous change, wherever it is — opened up to, as a jump chip's
  // target is. Landing on the row already selected moves nothing a screen
  // reader would hear, so that says so.
  const goToChange = useCallback(
    (back: boolean) => {
      const target = nextChangeStop(
        shown?.stops ?? [],
        documentPositions(nodes, rootId),
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
    [shown, nodes, rootId, selectedId, jumpTo, say],
  );

  return { shown, flashes, hidden, notice, goToChange };
}
